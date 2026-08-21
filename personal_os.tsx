import React, { useState, useEffect, useRef } from 'react';
import { 
  Brain, Zap, CheckCircle2, Circle, Clock, Battery, BatteryCharging, 
  Sparkles, Plus, Settings, AlertCircle, Play, Pause, Trash2, Tag, 
  MessageSquare, Sun, Moon, Dumbbell, Briefcase, Heart, Compass, 
  Sliders, Mic, Volume2, Image as ImageIcon, RefreshCw, Send, Check,
  Search, ExternalLink, ChevronDown, ChevronUp, Layers, HelpCircle,
  Lightbulb, Target, ShieldAlert, BarChart3, ArrowRight, BookOpen,
  PieChart, Activity, Sparkle, Edit3, X, Download, Upload, RotateCcw,
  CheckSquare
} from 'lucide-react';

const DOMAINS = {
  WORK: { 
    name: 'Business / Work', 
    color: 'bg-blue-500/10 text-blue-400 border-blue-500/30', 
    badge: 'bg-blue-500/20 text-blue-300', 
    icon: Briefcase,
    accent: 'from-blue-600 to-indigo-600' 
  },
  PERSONAL: { 
    name: 'Private / Life', 
    color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30', 
    badge: 'bg-emerald-500/20 text-emerald-300', 
    icon: Heart,
    accent: 'from-emerald-600 to-teal-600' 
  },
  HEALTH: { 
    name: 'Physical & Mental Health', 
    color: 'bg-rose-500/10 text-rose-400 border-rose-500/30', 
    badge: 'bg-rose-500/20 text-rose-300', 
    icon: Dumbbell,
    accent: 'from-rose-600 to-pink-600' 
  },
  LEISURE: { 
    name: 'Leisure & Rest', 
    color: 'bg-amber-500/10 text-amber-400 border-amber-500/30', 
    badge: 'bg-amber-500/20 text-amber-300', 
    icon: Compass,
    accent: 'from-amber-600 to-orange-600' 
  },
};

const ENERGY_LEVELS = {
  HIGH: { name: 'Peak Focus', icon: Zap, color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/30' },
  MEDIUM: { name: 'Moderate Energy', icon: BatteryCharging, color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/30' },
  LOW: { name: 'Low Energy', icon: Battery, color: 'text-slate-400', bg: 'bg-slate-500/10 border-slate-500/30' },
  OVERWHELMED: { name: 'Overwhelmed', icon: ShieldAlert, color: 'text-rose-400', bg: 'bg-rose-500/10 border-rose-500/30' }
};

const INITIAL_TASKS = [
  {
    id: '1',
    title: 'Review Q3 strategic goals and prune low-yield projects',
    domain: 'WORK',
    energy: 'HIGH',
    timeEstimate: 30,
    priority: 8,
    status: 'pending',
    createdAt: new Date().toISOString(),
    aiContext: 'High strategic impact for cognitive clarity.',
    subtasks: [],
    groundingData: null
  },
  {
    id: '2',
    title: '15-min vagus nerve breathing & neck release stretch',
    domain: 'HEALTH',
    energy: 'LOW',
    timeEstimate: 15,
    priority: 9,
    status: 'pending',
    createdAt: new Date().toISOString(),
    aiContext: 'Immediate nervous system reset to combat cognitive burnout.',
    subtasks: [],
    groundingData: null
  },
  {
    id: '3',
    title: 'Clear physical desk workspace to eliminate passive visual friction',
    domain: 'PERSONAL',
    energy: 'MEDIUM',
    timeEstimate: 20,
    priority: 6,
    status: 'pending',
    createdAt: new Date().toISOString(),
    aiContext: 'Reduces latent anxiety and background distraction.',
    subtasks: [],
    groundingData: null
  }
];

async function fetchGeminiWithRetry(url, options, maxRetries = 3) {
  let delay = 1000;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url, options);
      if (response.status === 429) {
        await new Promise(r => setTimeout(r, delay));
        delay *= 2;
        continue;
      }
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API status ${response.status}: ${errorText}`);
      }
      return await response.json();
    } catch (err) {
      if (i === maxRetries - 1) throw err;
      await new Promise(r => setTimeout(r, delay));
      delay *= 2;
    }
  }
}

function pcmToWavBlob(base64Data, sampleRate = 24000) {
  const binaryString = window.atob(base64Data);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const pcm16 = new Int16Array(bytes.buffer);

  const numChannels = 1;
  const wavBuffer = new ArrayBuffer(44 + pcm16.length * 2);
  const view = new DataView(wavBuffer);

  const writeString = (v, offset, str) => {
    for (let i = 0; i < str.length; i++) {
      v.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + pcm16.length * 2, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, pcm16.length * 2, true);

  let offset = 44;
  for (let i = 0; i < pcm16.length; i++, offset += 2) {
    view.setInt16(offset, pcm16[i], true);
  }

  return new Blob([wavBuffer], { type: 'audio/wav' });
}

export default function App() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('nexus_gemini_key') || '');
  const [tempApiKey, setTempApiKey] = useState(apiKey);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const [tasks, setTasks] = useState(() => {
    const saved = localStorage.getItem('nexus_tasks_v2');
    return saved ? JSON.parse(saved) : INITIAL_TASKS;
  });

  const [inboxInput, setInboxInput] = useState('');
  const [userEnergy, setUserEnergy] = useState('MEDIUM');
  const [availableTime, setAvailableTime] = useState(30);
  const [activeTab, setActiveTab] = useState('dashboard'); // 'dashboard', 'copilot', 'vision', 'analytics'
  const [filterDomain, setFilterDomain] = useState('ALL');

  const [isProcessingUnpack, setIsProcessingUnpack] = useState(false);
  const [isPrioritizing, setIsPrioritizing] = useState(false);
  const [recommendedPick, setRecommendedPick] = useState(null);
  
  const [loadingBrainstormId, setLoadingBrainstormId] = useState(null);
  const [loadingGroundingId, setLoadingGroundingId] = useState(null);

  const [isGeneratingBriefing, setIsGeneratingBriefing] = useState(false);
  const [briefingAudioUrl, setBriefingAudioUrl] = useState(null);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const audioRef = useRef(null);

  const [chatMessages, setChatMessages] = useState([
    { 
      sender: 'ai', 
      text: "Hello! I am your Nexus Copilot. I keep track of your full life spectrum (Work, Private, Health, Leisure). Tell me how you are feeling or throw any messy thoughts at me!" 
    }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);

  const [visionGoal, setVisionGoal] = useState('');
  const [visionDomain, setVisionDomain] = useState('WORK');
  const [visionGallery, setVisionGallery] = useState(() => {
    const saved = localStorage.getItem('nexus_vision_gallery');
    return saved ? JSON.parse(saved) : [];
  });
  const [isGeneratingVision, setIsGeneratingVision] = useState(false);

  const [expandedTaskId, setExpandedTaskId] = useState(null);

  // Focus Timer Modal State
  const [activeTimerTask, setActiveTimerTask] = useState(null);
  const [timerSecondsLeft, setTimerSecondsLeft] = useState(0);
  const [isTimerActive, setIsTimerActive] = useState(false);

  // Manual Add/Edit Task Modal State
  const [editingTask, setEditingTask] = useState(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [manualTaskForm, setManualTaskForm] = useState({
    title: '',
    domain: 'WORK',
    energy: 'MEDIUM',
    timeEstimate: 30,
    priority: 5,
    aiContext: 'Manually added to spectrum.'
  });

  // Notification Toast State
  const [toastMessage, setToastMessage] = useState(null);

  const triggerToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  useEffect(() => {
    localStorage.setItem('nexus_tasks_v2', JSON.stringify(tasks));
  }, [tasks]);

  useEffect(() => {
    localStorage.setItem('nexus_gemini_key', apiKey);
  }, [apiKey]);

  useEffect(() => {
    localStorage.setItem('nexus_vision_gallery', JSON.stringify(visionGallery));
  }, [visionGallery]);

  useEffect(() => {
    let interval = null;
    if (isTimerActive && timerSecondsLeft > 0) {
      interval = setInterval(() => {
        setTimerSecondsLeft(prev => prev - 1);
      }, 1000);
    } else if (timerSecondsLeft === 0 && isTimerActive) {
      setIsTimerActive(false);
      triggerToast('🎉 Focus Block Completed! Take a deep breath and rest.');
      if (activeTimerTask) {
        toggleTaskStatus(activeTimerTask.id);
      }
    }
    return () => clearInterval(interval);
  }, [isTimerActive, timerSecondsLeft]);

  const handleStartTimer = (task) => {
    setActiveTimerTask(task);
    setTimerSecondsLeft((task.timeEstimate || 15) * 60);
    setIsTimerActive(true);
    triggerToast(`Focus session started for: ${task.title}`);
  };

  const formatTimerDisplay = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleUnpackThought = async (overrideText) => {
    const textToProcess = overrideText || inboxInput;
    if (!textToProcess.trim()) return;

    setIsProcessingUnpack(true);

    const prompt = `You are a world-class executive assistant and cognitive coach for a Personal OS app. 
    Analyze this raw, chaotic thought or brain dump: "${textToProcess}".
    Extract all distinct tasks, ideas, or habits implied.
    For each extracted item, return a JSON object with:
    - "title": Actionable task title (starts with imperative verb)
    - "domain": One of "WORK", "PERSONAL", "HEALTH", "LEISURE"
    - "energy": One of "HIGH", "MEDIUM", "LOW", "OVERWHELMED"
    - "timeEstimate": Estimated duration in minutes (number: 5, 15, 30, 45, 60, 90, 120)
    - "priority": Priority score from 1 to 10
    - "aiContext": A 1-sentence note explaining why this helps reduce mental friction.`;

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;
      const payload = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                title: { type: "STRING" },
                domain: { type: "STRING", enum: ["WORK", "PERSONAL", "HEALTH", "LEISURE"] },
                energy: { type: "STRING", enum: ["HIGH", "MEDIUM", "LOW", "OVERWHELMED"] },
                timeEstimate: { type: "NUMBER" },
                priority: { type: "NUMBER" },
                aiContext: { type: "STRING" }
              },
              required: ["title", "domain", "energy", "timeEstimate", "priority", "aiContext"]
            }
          }
        }
      };

      const data = await fetchGeminiWithRetry(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const parsedText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (parsedText) {
        const items = JSON.parse(parsedText);
        const newTasks = items.map(item => ({
          id: 'task_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
          title: item.title,
          domain: item.domain || 'PERSONAL',
          energy: item.energy || 'MEDIUM',
          timeEstimate: item.timeEstimate || 20,
          priority: item.priority || 5,
          status: 'pending',
          createdAt: new Date().toISOString(),
          aiContext: item.aiContext || 'Unpacked by Gemini AI',
          subtasks: [],
          groundingData: null
        }));

        setTasks(prev => [...newTasks, ...prev]);
        if (!overrideText) setInboxInput('');
        triggerToast(`Successfully unpacked ${newTasks.length} actionable item(s)!`);
      }
    } catch (err) {
      console.error('Gemini Unpack Error:', err);
      const fallbackTask = {
        id: 'task_' + Date.now(),
        title: textToProcess,
        domain: 'PERSONAL',
        energy: 'MEDIUM',
        timeEstimate: 20,
        priority: 6,
        status: 'pending',
        createdAt: new Date().toISOString(),
        aiContext: 'Captured into Inbox',
        subtasks: [],
        groundingData: null
      };
      setTasks(prev => [fallbackTask, ...prev]);
      if (!overrideText) setInboxInput('');
      triggerToast('Thought captured directly into Inbox.');
    } finally {
      setIsProcessingUnpack(false);
    }
  };

  const handleBrainstormTask = async (taskId) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    setLoadingBrainstormId(taskId);

    const prompt = `Break down the task "${task.title}" (Domain: ${task.domain}) into 3 to 5 low-friction, 5-minute actionable sub-steps. 
    Ensure steps are super concrete so someone with low motivation can start immediately without feeling overwhelmed.`;

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;
      const payload = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                stepText: { type: "STRING" },
                estMins: { type: "NUMBER" }
              },
              required: ["stepText", "estMins"]
            }
          }
        }
      };

      const data = await fetchGeminiWithRetry(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const parsedText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (parsedText) {
        const steps = JSON.parse(parsedText);
        setTasks(prev => prev.map(t => {
          if (t.id === taskId) {
            return {
              ...t,
              subtasks: steps.map((s, idx) => ({ id: `${taskId}_sub_${idx}`, text: s.stepText, estMins: s.estMins, done: false }))
            };
          }
          return t;
        }));
        setExpandedTaskId(taskId);
        triggerToast('Generated micro sub-steps with Gemini.');
      }
    } catch (err) {
      console.error('Brainstorm Error:', err);
      triggerToast('Unable to generate sub-steps. Check API Key.');
    } finally {
      setLoadingBrainstormId(null);
    }
  };

  const handleGroundedResearch = async (taskId) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    setLoadingGroundingId(taskId);

    const userQuery = `Find current best practices, actionable tips, or quick key insights for: "${task.title}". Provide a concise 2-sentence summary and key points.`;

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;
      const payload = {
        contents: [{ parts: [{ text: userQuery }] }],
        tools: [{ "google_search": {} }],
        systemInstruction: {
          parts: [{ text: "You are an expert research strategist. Provide concise, grounded insights with accurate web facts." }]
        }
      };

      const data = await fetchGeminiWithRetry(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const candidate = data?.candidates?.[0];
      const text = candidate?.content?.parts?.[0]?.text || "No research summary available.";
      
      const attributions = candidate?.groundingMetadata?.groundingAttributions || [];
      const sources = attributions
        .map(attr => ({
          uri: attr.web?.uri,
          title: attr.web?.title
        }))
        .filter(s => s.uri && s.title);

      setTasks(prev => prev.map(t => {
        if (t.id === taskId) {
          return {
            ...t,
            groundingData: {
              summary: text,
              sources: sources
            }
          };
        }
        return t;
      }));
      setExpandedTaskId(taskId);
      triggerToast('Fetched Google Web Grounded insights.');
    } catch (err) {
      console.error('Grounding Research Error:', err);
      triggerToast('Web research unavailable right now.');
    } finally {
      setLoadingGroundingId(null);
    }
  };

  const handlePrioritizeNow = async () => {
    setIsPrioritizing(true);
    const pendingTasks = tasks.filter(t => t.status === 'pending');

    if (pendingTasks.length === 0) {
      setRecommendedPick(null);
      setIsPrioritizing(false);
      triggerToast('No pending tasks available to prioritize.');
      return;
    }

    const contextPrompt = `You are a personal cognitive OS decision engine.
    Current User Context:
    - User Energy State: ${userEnergy} (${ENERGY_LEVELS[userEnergy]?.name})
    - Available Time: ${availableTime} minutes
    - Pending Tasks (${pendingTasks.length}): ${JSON.stringify(pendingTasks.map(t => ({ id: t.id, title: t.title, domain: t.domain, energy: t.energy, time: t.timeEstimate, priority: t.priority })))}
    
    Select the SINGLE best task for the user to execute RIGHT NOW.
    Return JSON with:
    - "selectedTaskId": ID of the chosen task
    - "reasoning": 2-sentence explanation why this task perfectly matches their current energy and time window.
    - "mindsetPrimer": 1 actionable sentence to prime their focus before starting.`;

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;
      const payload = {
        contents: [{ parts: [{ text: contextPrompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              selectedTaskId: { type: "STRING" },
              reasoning: { type: "STRING" },
              mindsetPrimer: { type: "STRING" }
            },
            required: ["selectedTaskId", "reasoning", "mindsetPrimer"]
          }
        }
      };

      const data = await fetchGeminiWithRetry(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const parsed = JSON.parse(data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}');
      const chosenTask = pendingTasks.find(t => t.id === parsed.selectedTaskId) || pendingTasks[0];

      setRecommendedPick({
        task: chosenTask,
        reasoning: parsed.reasoning || "Selected based on optimal energy alignment.",
        mindsetPrimer: parsed.mindsetPrimer || "Take a deep breath and start with 2 minutes of effortless focus."
      });
      triggerToast('Decision Engine selection ready!');
    } catch (err) {
      console.error('Prioritizer Error:', err);
      const fallback = pendingTasks.find(t => t.timeEstimate <= availableTime) || pendingTasks[0];
      setRecommendedPick({
        task: fallback,
        reasoning: `Matches your available ${availableTime}m block.`,
        mindsetPrimer: "Focus on momentum rather than perfection."
      });
    } finally {
      setIsPrioritizing(false);
    }
  };

  const handleGenerateAudioBriefing = async () => {
    setIsGeneratingBriefing(true);
    if (audioRef.current) {
      audioRef.current.pause();
      setIsPlayingAudio(false);
    }

    const pendingCount = tasks.filter(t => t.status === 'pending').length;
    const workCount = tasks.filter(t => t.status === 'pending' && t.domain === 'WORK').length;
    const healthCount = tasks.filter(t => t.status === 'pending' && t.domain === 'HEALTH').length;

    const briefingPrompt = `Say cheerfully and calmly in under 30 seconds: 
    Good day! You currently have ${pendingCount} pending items across your life spectrum. You have ${workCount} work items and ${healthCount} health priorities. Your current energy is ${userEnergy.toLowerCase()}. Pick one high-value action, embrace momentum, and remember to rest when needed. Let's make today count!`;

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`;
      const payload = {
        contents: [{
          parts: [{ text: briefingPrompt }]
        }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: "Zephyr" }
            }
          }
        }
      };

      const data = await fetchGeminiWithRetry(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const part = data?.candidates?.[0]?.content?.parts?.[0];
      const audioData = part?.inlineData?.data;
      const mimeType = part?.inlineData?.mimeType || '';

      if (audioData) {
        const rateMatch = mimeType.match(/rate=(\d+)/);
        const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;

        const wavBlob = pcmToWavBlob(audioData, sampleRate);
        const urlObj = URL.createObjectURL(wavBlob);
        setBriefingAudioUrl(urlObj);

        setTimeout(() => {
          if (audioRef.current) {
            audioRef.current.play();
            setIsPlayingAudio(true);
          }
        }, 100);
      }
    } catch (err) {
      console.error('Gemini TTS Error, falling back to Web Speech API', err);
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(`Good day! You have ${pendingCount} tasks queued. Focus on aligned actions for your ${userEnergy.toLowerCase()} energy state.`);
        utterance.onstart = () => setIsPlayingAudio(true);
        utterance.onend = () => setIsPlayingAudio(false);
        window.speechSynthesis.speak(utterance);
      }
    } finally {
      setIsGeneratingBriefing(false);
    }
  };

  const handleGenerateVisionGoal = async () => {
    if (!visionGoal.trim()) return;
    setIsGeneratingVision(true);

    try {
      const refineUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;
      const refinePayload = {
        contents: [{
          parts: [{ text: `Expand this life goal into a vivid, ultra-detailed photorealistic visual prompt for image generation: "${visionGoal}". Domain: ${visionDomain}. Keep prompt under 40 words.` }]
        }]
      };

      const refineData = await fetchGeminiWithRetry(refineUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(refinePayload)
      });

      const expandedPrompt = refineData?.candidates?.[0]?.content?.parts?.[0]?.text || visionGoal;

      const imagenUrl = `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${apiKey}`;
      const imagenPayload = {
        instances: [{ prompt: expandedPrompt }],
        parameters: { sampleCount: 1 }
      };

      const imagenResponse = await fetchGeminiWithRetry(imagenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(imagenPayload)
      });

      const base64 = imagenResponse?.predictions?.[0]?.bytesBase64Encoded;
      if (base64) {
        const newGoal = {
          id: 'vision_' + Date.now(),
          title: visionGoal,
          domain: visionDomain,
          imageUrl: `data:image/png;base64,${base64}`,
          promptUsed: expandedPrompt,
          createdAt: new Date().toLocaleDateString()
        };
        setVisionGallery(prev => [newGoal, ...prev]);
        setVisionGoal('');
        triggerToast('Generated visual board artwork with Imagen 4!');
      }
    } catch (err) {
      console.error('Imagen Generation Error:', err);
      const fallbackGoal = {
        id: 'vision_' + Date.now(),
        title: visionGoal,
        domain: visionDomain,
        imageUrl: null,
        promptUsed: visionGoal,
        createdAt: new Date().toLocaleDateString()
      };
      setVisionGallery(prev => [fallbackGoal, ...prev]);
      setVisionGoal('');
      triggerToast('Vision goal saved (Imagen artwork unavailable).');
    } finally {
      setIsGeneratingVision(false);
    }
  };

  const handleSendCopilotChat = async () => {
    if (!chatInput.trim()) return;

    const userMsg = { sender: 'user', text: chatInput };
    setChatMessages(prev => [...prev, userMsg]);
    const currentMsgText = chatInput;
    setChatInput('');
    setIsChatLoading(true);

    const pendingTasksSummary = tasks.filter(t => t.status === 'pending').map(t => `${t.title} (${DOMAINS[t.domain]?.name}, ${t.energy} energy)`).join('; ');

    const systemPrompt = `You are Nexus Executive Copilot, an empathetic personal operating system counselor.
    Context:
    - User Current Energy: ${userEnergy}
    - Available Time Window: ${availableTime} mins
    - Pending Tasks in Life Spectrum: ${pendingTasksSummary || "No pending tasks."}
    
    Provide helpful, supportive, executive guidance. Be direct, warm, and structured.`;

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;
      const payload = {
        contents: [{ parts: [{ text: currentMsgText }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] }
      };

      const data = await fetchGeminiWithRetry(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text || "I'm here to support your cognitive workflow.";
      setChatMessages(prev => [...prev, { sender: 'ai', text: reply }]);
    } catch (err) {
      console.error('Copilot Chat Error:', err);
      setChatMessages(prev => [...prev, { 
        sender: 'ai', 
        text: `I noticed your current energy is set to ${userEnergy.toLowerCase()}. Focus on tackling high-yield items when peak energy strikes, or switch to low-friction health/rest habits.` 
      }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  const toggleTaskStatus = (id) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, status: t.status === 'completed' ? 'pending' : 'completed' } : t));
  };

  const toggleSubtask = (taskId, subId) => {
    setTasks(prev => prev.map(t => {
      if (t.id === taskId) {
        return {
          ...t,
          subtasks: t.subtasks.map(s => s.id === subId ? { ...s, done: !s.done } : s)
        };
      }
      return t;
    }));
  };

  const deleteTask = (id) => {
    setTasks(prev => prev.filter(t => t.id !== id));
    if (recommendedPick?.task?.id === id) setRecommendedPick(null);
    triggerToast('Task removed from matrix.');
  };

  const clearCompletedTasks = () => {
    setTasks(prev => prev.filter(t => t.status !== 'completed'));
    triggerToast('Cleared all completed tasks.');
  };

  const handleCreateManualTask = (e) => {
    e.preventDefault();
    if (!manualTaskForm.title.trim()) return;

    const newTask = {
      id: 'task_' + Date.now(),
      title: manualTaskForm.title,
      domain: manualTaskForm.domain,
      energy: manualTaskForm.energy,
      timeEstimate: Number(manualTaskForm.timeEstimate),
      priority: Number(manualTaskForm.priority),
      status: 'pending',
      createdAt: new Date().toISOString(),
      aiContext: manualTaskForm.aiContext || 'Manually defined action item.',
      subtasks: [],
      groundingData: null
    };

    setTasks(prev => [newTask, ...prev]);
    setIsAddModalOpen(false);
    setManualTaskForm({
      title: '',
      domain: 'WORK',
      energy: 'MEDIUM',
      timeEstimate: 30,
      priority: 5,
      aiContext: 'Manually added to spectrum.'
    });
    triggerToast('Custom task added to matrix.');
  };

  const handleSaveEditedTask = (e) => {
    e.preventDefault();
    if (!editingTask || !editingTask.title.trim()) return;

    setTasks(prev => prev.map(t => t.id === editingTask.id ? editingTask : t));
    setEditingTask(null);
    triggerToast('Task updated successfully.');
  };

  const exportData = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify({ tasks, visionGallery }));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `nexus_os_backup_${new Date().toISOString().slice(0,10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    triggerToast('Exported backup file.');
  };

  const importData = (e) => {
    const fileReader = new FileReader();
    if (e.target.files && e.target.files[0]) {
      fileReader.readAsText(e.target.files[0], "UTF-8");
      fileReader.onload = (event) => {
        try {
          const parsed = JSON.parse(event.target.result);
          if (parsed.tasks) setTasks(parsed.tasks);
          if (parsed.visionGallery) setVisionGallery(parsed.visionGallery);
          triggerToast('Successfully imported backup!');
        } catch (err) {
          triggerToast('Invalid backup JSON format.');
        }
      };
    }
  };

  const pendingCount = tasks.filter(t => t.status === 'pending').length;
  const completedCount = tasks.filter(t => t.status === 'completed').length;
  const totalMins = tasks.filter(t => t.status === 'pending').reduce((acc, t) => acc + (t.timeEstimate || 0), 0);

  const filteredTasks = tasks.filter(t => {
    if (filterDomain !== 'ALL' && t.domain !== filterDomain) return false;
    return true;
  });

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-blue-500 selection:text-white pb-12">
      {/* Toast Notification Floating Alert */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 bg-blue-600 text-white px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2 text-xs font-semibold animate-bounce border border-blue-400">
          <Sparkles className="w-4 h-4 text-amber-300 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Hidden Audio Player for Speech Synthesis */}
      <audio 
        ref={audioRef} 
        src={briefingAudioUrl || ''} 
        onEnded={() => setIsPlayingAudio(false)} 
        onPause={() => setIsPlayingAudio(false)}
        className="hidden" 
      />

      <header className="border-b border-slate-800 bg-slate-900/70 backdrop-blur-md sticky top-0 z-50 px-4 py-3">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-gradient-to-tr from-blue-600 via-indigo-600 to-purple-600 p-2.5 rounded-xl shadow-lg shadow-blue-500/20">
              <Brain className="w-6 h-6 text-white animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-bold text-lg leading-none bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
                  Nexus OS
                </h1>
                <span className="px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 text-[10px] font-semibold border border-blue-500/30">
                  Gemini 3 Powered
                </span>
              </div>
              <span className="text-xs text-slate-400">Personal Cognitive Operating System</span>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex bg-slate-900/90 p-1 rounded-xl border border-slate-800/80 shadow-inner overflow-x-auto">
            <button 
              onClick={() => setActiveTab('dashboard')} 
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all shrink-0 ${activeTab === 'dashboard' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-white'}`}
            >
              Spectrum Dashboard
            </button>
            <button 
              onClick={() => setActiveTab('copilot')} 
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all shrink-0 ${activeTab === 'copilot' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-white'}`}
            >
              AI Copilot
            </button>
            <button 
              onClick={() => setActiveTab('vision')} 
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all shrink-0 ${activeTab === 'vision' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-white'}`}
            >
              Imagen Vision Board
            </button>
            <button 
              onClick={() => setActiveTab('analytics')} 
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all shrink-0 ${activeTab === 'analytics' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-white'}`}
            >
              Cognitive Load
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button 
              onClick={() => setIsAddModalOpen(true)}
              className="px-3 py-2 bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition"
              title="Add Custom Action"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">Add Task</span>
            </button>
            <button 
              onClick={() => setIsSettingsOpen(true)}
              className="p-2.5 text-slate-400 hover:text-white hover:bg-slate-800/80 rounded-xl transition border border-slate-800 shrink-0"
              title="Engine Settings & Data Management"
            >
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-4 md:p-6 space-y-6">

        <div className="bg-slate-900 border border-slate-800/80 rounded-2xl p-4 shadow-2xl relative overflow-hidden group">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500" />
          <div className="flex flex-col md:flex-row gap-3 items-center">
            <div className="relative flex-1 w-full">
              <input 
                type="text" 
                value={inboxInput}
                onChange={(e) => setInboxInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleUnpackThought()}
                placeholder="Dump chaotic thoughts, unorganized tasks, or life ideas (e.g. 'Feeling stressed about Q3 deck, need to stretch lower back, buy healthy snacks')"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-4 pr-10 py-3.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition shadow-inner"
              />
            </div>
            <button 
              onClick={() => handleUnpackThought()}
              disabled={isProcessingUnpack || !inboxInput.trim()}
              className="w-full md:w-auto px-6 py-3.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-50 text-white font-semibold text-sm rounded-xl flex items-center justify-center gap-2 transition shadow-lg shadow-blue-600/25 shrink-0"
            >
              {isProcessingUnpack ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              <span>Unpack with Gemini</span>
            </button>
          </div>
        </div>

        {activeTab === 'dashboard' && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              
              {/* Energy Level State Selector */}
              <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-4 flex flex-col justify-between space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Current Neuro-State</span>
                  <span className="text-[10px] text-slate-500">Adaptive filter</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(ENERGY_LEVELS).map(([key, val]) => {
                    const Icon = val.icon;
                    const isSelected = userEnergy === key;
                    return (
                      <button
                        key={key}
                        onClick={() => setUserEnergy(key)}
                        className={`flex items-center gap-2 p-2 rounded-xl border text-xs transition ${isSelected ? `${val.bg} ${val.color} font-bold border-blue-500 shadow-sm` : 'border-slate-800/60 text-slate-400 hover:bg-slate-800/50'}`}
                      >
                        <Icon className={`w-3.5 h-3.5 ${val.color}`} />
                        <span className="truncate">{val.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Time Block Selector */}
              <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-4 flex flex-col justify-between space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Available Time Block</span>
                  <span className="text-xs font-semibold text-blue-400">{availableTime} mins</span>
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {[15, 30, 60, 120].map((mins) => (
                    <button
                      key={mins}
                      onClick={() => setAvailableTime(mins)}
                      className={`py-2 rounded-xl border text-xs font-semibold transition ${availableTime === mins ? 'bg-blue-600/20 border-blue-500 text-blue-400' : 'border-slate-800 text-slate-400 hover:bg-slate-800'}`}
                    >
                      {mins < 60 ? `${mins}m` : `${mins / 60}h`}
                    </button>
                  ))}
                </div>
              </div>

              {/* Gemini Audio Briefing Control */}
              <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-4 flex flex-col justify-between space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Daily Focus Audio Briefing</span>
                  <span className="text-[10px] text-indigo-400 font-medium">Gemini 2.5 TTS</span>
                </div>
                <button
                  onClick={handleGenerateAudioBriefing}
                  disabled={isGeneratingBriefing}
                  className="w-full py-3 bg-gradient-to-r from-indigo-900/50 to-purple-900/50 hover:from-indigo-800/60 hover:to-purple-800/60 border border-indigo-500/40 rounded-xl text-xs font-semibold text-indigo-200 flex items-center justify-center gap-2.5 transition shadow-md"
                >
                  {isGeneratingBriefing ? (
                    <RefreshCw className="w-4 h-4 animate-spin text-indigo-400" />
                  ) : isPlayingAudio ? (
                    <Volume2 className="w-4 h-4 text-indigo-400 animate-bounce" />
                  ) : (
                    <Play className="w-4 h-4 text-indigo-400" />
                  )}
                  <span>{isGeneratingBriefing ? 'Synthesizing Audio...' : isPlayingAudio ? 'Playing Briefing...' : 'Listen to Gemini Briefing'}</span>
                </button>
              </div>

            </div>

            <div className="bg-slate-900/90 border border-blue-500/30 rounded-2xl p-5 shadow-xl relative overflow-hidden">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-blue-400 text-xs font-bold uppercase tracking-wider">
                  <Sparkles className="w-4 h-4" />
                  <span>Gemini Decision Engine — Optimal Action Recommendation</span>
                </div>
                <button
                  onClick={handlePrioritizeNow}
                  disabled={isPrioritizing}
                  className="px-3.5 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 rounded-lg text-xs font-medium flex items-center gap-1.5 transition"
                >
                  {isPrioritizing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Target className="w-3.5 h-3.5" />}
                  <span>Evaluate What To Do NOW</span>
                </button>
              </div>

              {recommendedPick ? (
                <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 space-y-3">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${DOMAINS[recommendedPick.task.domain]?.color}`}>
                          {DOMAINS[recommendedPick.task.domain]?.name}
                        </span>
                        <span className="text-xs text-slate-400 flex items-center gap-1">
                          <Clock className="w-3 h-3" /> {recommendedPick.task.timeEstimate} mins
                        </span>
                      </div>
                      <h3 className="text-base font-bold text-white">{recommendedPick.task.title}</h3>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleStartTimer(recommendedPick.task)}
                        className="px-3.5 py-2 bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/30 font-medium text-xs rounded-xl flex items-center gap-1.5 transition shrink-0"
                      >
                        <Clock className="w-4 h-4" />
                        <span>Start Focus Block</span>
                      </button>
                      <button
                        onClick={() => toggleTaskStatus(recommendedPick.task.id)}
                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs rounded-xl flex items-center gap-2 transition shadow-lg shrink-0"
                      >
                        <Check className="w-4 h-4" />
                        <span>Complete Task</span>
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-2 border-t border-slate-800 text-xs">
                    <div className="text-slate-300">
                      <strong className="text-blue-400">Why Selected: </strong> {recommendedPick.reasoning}
                    </div>
                    <div className="text-emerald-300 italic">
                      <strong className="text-emerald-400 not-italic">Mindset Primer: </strong> "{recommendedPick.mindsetPrimer}"
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-400 italic">
                  Click "Evaluate What To Do NOW" to have Gemini analyze your workload and recommend the ideal micro-focus task for your current neuro-state.
                </p>
              )}
            </div>

            <div className="space-y-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-800 pb-3">
                <div className="flex items-center gap-3">
                  <h2 className="text-sm font-bold uppercase tracking-wider text-slate-300">Life Spectrum Matrix</h2>
                  <span className="px-2 py-0.5 bg-slate-800 text-slate-400 text-xs rounded-full">{pendingCount} pending ({totalMins}m)</span>
                  {completedCount > 0 && (
                    <button 
                      onClick={clearCompletedTasks}
                      className="text-xs text-slate-500 hover:text-rose-400 underline transition"
                    >
                      Clear {completedCount} completed
                    </button>
                  )}
                </div>

                {/* Domain Filter Pills */}
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => setFilterDomain('ALL')}
                    className={`px-3 py-1 rounded-lg text-xs font-medium transition ${filterDomain === 'ALL' ? 'bg-slate-800 text-white border border-slate-700' : 'text-slate-400 hover:text-white'}`}
                  >
                    All Domains
                  </button>
                  {Object.entries(DOMAINS).map(([key, val]) => (
                    <button
                      key={key}
                      onClick={() => setFilterDomain(key)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${filterDomain === key ? `${val.badge} border border-slate-700` : 'text-slate-400 hover:text-white'}`}
                    >
                      {val.name.split('/')[0]}
                    </button>
                  ))}
                </div>
              </div>

              {}
              <div className="space-y-3">
                {filteredTasks.length === 0 ? (
                  <div className="bg-slate-900/40 border border-slate-800/60 rounded-2xl p-8 text-center text-slate-500 text-sm">
                    No active tasks match this filter. Dump chaotic thoughts in the top bar to populate your matrix!
                  </div>
                ) : (
                  filteredTasks.map((task) => {
                    const isExpanded = expandedTaskId === task.id;
                    const isCompleted = task.status === 'completed';

                    return (
                      <div 
                        key={task.id}
                        className={`bg-slate-900 border rounded-2xl p-4 transition shadow-md ${isCompleted ? 'opacity-50 border-slate-800/50 bg-slate-950/40' : 'border-slate-800 hover:border-slate-700'}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-3 flex-1 min-w-0">
                            <button 
                              onClick={() => toggleTaskStatus(task.id)}
                              className={`mt-0.5 transition ${isCompleted ? 'text-emerald-400' : 'text-slate-600 hover:text-emerald-400'}`}
                            >
                              {isCompleted ? <CheckCircle2 className="w-5 h-5" /> : <Circle className="w-5 h-5" />}
                            </button>

                            <div className="flex-1 min-w-0">
                              <p className={`font-semibold text-sm ${isCompleted ? 'line-through text-slate-500' : 'text-slate-100'}`}>
                                {task.title}
                              </p>

                              <div className="flex flex-wrap items-center gap-2 mt-2">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${DOMAINS[task.domain]?.color}`}>
                                  {DOMAINS[task.domain]?.name}
                                </span>
                                <span className="text-xs text-slate-400 flex items-center gap-1">
                                  <Clock className="w-3 h-3 text-slate-500" /> {task.timeEstimate}m
                                </span>
                                <span className="text-xs text-slate-500 flex items-center gap-1">
                                  <Zap className="w-3 h-3 text-amber-500" /> {ENERGY_LEVELS[task.energy]?.name}
                                </span>
                              </div>

                              {task.aiContext && (
                                <p className="text-xs text-slate-400 mt-2 italic bg-slate-950/50 p-2 rounded-lg border border-slate-800/60">
                                  💡 {task.aiContext}
                                </p>
                              )}
                            </div>
                          </div>

                          {/* Quick Gemini Action Buttons */}
                          <div className="flex items-center gap-1.5 shrink-0">
                            {!isCompleted && (
                              <button
                                onClick={() => handleStartTimer(task)}
                                title="Start Focus Timer"
                                className="p-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-xl text-xs flex items-center gap-1 transition"
                              >
                                <Play className="w-3 h-3" />
                                <span className="hidden sm:inline">Timer</span>
                              </button>
                            )}

                            <button
                              onClick={() => handleBrainstormTask(task.id)}
                              disabled={loadingBrainstormId === task.id}
                              title="Brainstorm 5-minute sub-steps with Gemini"
                              className="p-2 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 rounded-xl text-xs flex items-center gap-1 transition"
                            >
                              {loadingBrainstormId === task.id ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Lightbulb className="w-3.5 h-3.5" />}
                              <span className="hidden sm:inline">Sub-steps</span>
                            </button>

                            <button
                              onClick={() => handleGroundedResearch(task.id)}
                              disabled={loadingGroundingId === task.id}
                              title="Research key facts with Google Grounding"
                              className="p-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-xl text-xs flex items-center gap-1 transition"
                            >
                              {loadingGroundingId === task.id ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                              <span className="hidden sm:inline">Ground Web</span>
                            </button>

                            <button
                              onClick={() => setEditingTask(task)}
                              className="p-2 text-slate-400 hover:text-white rounded-xl transition"
                              title="Edit Task Details"
                            >
                              <Edit3 className="w-4 h-4" />
                            </button>

                            <button
                              onClick={() => setExpandedTaskId(isExpanded ? null : task.id)}
                              className="p-2 text-slate-400 hover:text-white rounded-xl transition"
                            >
                              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                            </button>

                            <button
                              onClick={() => deleteTask(task.id)}
                              className="p-2 text-slate-600 hover:text-rose-400 transition"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="mt-4 pt-4 border-t border-slate-800/80 space-y-4">
                            {/* Subtasks */}
                            {task.subtasks && task.subtasks.length > 0 && (
                              <div className="space-y-2">
                                <span className="text-xs font-bold uppercase tracking-wider text-indigo-400 flex items-center gap-1">
                                  <Layers className="w-3.5 h-3.5" /> Actionable Sub-Steps (Gemini Brainstormed)
                                </span>
                                <div className="space-y-1.5 pl-2">
                                  {task.subtasks.map((st) => (
                                    <div key={st.id} className="flex items-center gap-2 text-xs">
                                      <button 
                                        onClick={() => toggleSubtask(task.id, st.id)}
                                        className={st.done ? 'text-emerald-400' : 'text-slate-600'}
                                      >
                                        {st.done ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Circle className="w-3.5 h-3.5" />}
                                      </button>
                                      <span className={st.done ? 'line-through text-slate-500' : 'text-slate-300'}>
                                        {st.text} ({st.estMins}m)
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Grounded Web Insights */}
                            {task.groundingData && (
                              <div className="bg-slate-950 p-3.5 rounded-xl border border-emerald-500/30 space-y-2 text-xs">
                                <div className="flex items-center gap-1.5 text-emerald-400 font-bold uppercase tracking-wider">
                                  <Search className="w-3.5 h-3.5" /> Google Search Grounded Key Summary
                                </div>
                                <p className="text-slate-300 leading-relaxed">{task.groundingData.summary}</p>
                                
                                {task.groundingData.sources && task.groundingData.sources.length > 0 && (
                                  <div className="pt-2 border-t border-slate-800">
                                    <span className="text-[10px] text-slate-500 block mb-1 font-semibold uppercase">Verified Citations:</span>
                                    <div className="flex flex-wrap gap-2">
                                      {task.groundingData.sources.map((src, idx) => (
                                        <a
                                          key={idx}
                                          href={src.uri}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="text-[11px] text-blue-400 hover:underline flex items-center gap-1 bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20 truncate max-w-xs"
                                        >
                                          <span>{src.title}</span>
                                          <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                                        </a>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}

                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </>
        )}

        {activeTab === 'copilot' && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl flex flex-col h-[580px] overflow-hidden shadow-2xl">
            <div className="p-4 border-b border-slate-800 bg-slate-950/60 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-blue-400" />
                <div>
                  <h2 className="font-bold text-sm">Nexus Copilot Counselor</h2>
                  <span className="text-xs text-slate-400">Contextual Chat Grounded in Your Life Spectrum</span>
                </div>
              </div>
              <span className="px-2.5 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-xs rounded-full font-medium">
                Live Memory Active
              </span>
            </div>

            {/* Chat History */}
            <div className="flex-1 p-4 overflow-y-auto space-y-3.5">
              {chatMessages.map((msg, idx) => (
                <div 
                  key={idx} 
                  className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div className={`max-w-[82%] rounded-2xl p-4 text-sm leading-relaxed ${msg.sender === 'user' ? 'bg-blue-600 text-white shadow-md' : 'bg-slate-800 text-slate-200 border border-slate-700/60 shadow-md'}`}>
                    {msg.text}
                  </div>
                </div>
              ))}
              {isChatLoading && (
                <div className="flex justify-start">
                  <div className="bg-slate-800 border border-slate-700/60 rounded-2xl p-3.5 text-xs text-slate-400 flex items-center gap-2">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-400" />
                    <span>Evaluating current life spectrum context...</span>
                  </div>
                </div>
              )}
            </div>

            {/* Input Bar */}
            <div className="p-3 border-t border-slate-800 bg-slate-950/60 flex gap-2">
              <input 
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendCopilotChat()}
                placeholder="Ask for advice, re-prioritize your day, or talk through mental blockages..."
                className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button 
                onClick={handleSendCopilotChat}
                disabled={!chatInput.trim() || isChatLoading}
                className="px-5 py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl transition font-medium flex items-center gap-2 shadow-md"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {activeTab === 'vision' && (
          <div className="space-y-6">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-5 shadow-2xl">
              <div>
                <h2 className="text-lg font-bold text-white mb-1">Imagen 4 Life Vision Board</h2>
                <p className="text-xs text-slate-400">Generate high-fidelity visual motivators for your long-term life domain milestones.</p>
              </div>

              <div className="flex flex-col md:flex-row gap-3">
                <input 
                  type="text"
                  value={visionGoal}
                  onChange={(e) => setVisionGoal(e.target.value)}
                  placeholder="e.g., A tranquil wooden cabin desk overlooking a mist-covered pine forest after finishing my big work goal"
                  className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                
                <select 
                  value={visionDomain}
                  onChange={(e) => setVisionDomain(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-3 text-xs text-slate-300 focus:outline-none"
                >
                  {Object.entries(DOMAINS).map(([key, val]) => (
                    <option key={key} value={key}>{val.name}</option>
                  ))}
                </select>

                <button 
                  onClick={handleGenerateVisionGoal}
                  disabled={isGeneratingVision || !visionGoal.trim()}
                  className="px-6 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:opacity-50 text-white font-semibold text-xs rounded-xl flex items-center justify-center gap-2 transition shadow-lg shrink-0"
                >
                  {isGeneratingVision ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />}
                  <span>Generate Vision Art</span>
                </button>
              </div>
            </div>

            {/* Vision Board Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {visionGallery.length === 0 ? (
                <div className="col-span-full bg-slate-900/40 border border-slate-800 rounded-2xl p-8 text-center text-slate-500 text-sm">
                  No vision goals created yet. Enter a vision above to generate custom AI artwork!
                </div>
              ) : (
                visionGallery.map((item) => (
                  <div key={item.id} className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl space-y-3 p-4">
                    <div className="flex items-center justify-between">
                      <span className={`px-2.5 py-0.5 rounded text-[10px] font-bold border ${DOMAINS[item.domain]?.color}`}>
                        {DOMAINS[item.domain]?.name}
                      </span>
                      <span className="text-[10px] text-slate-500">{item.createdAt}</span>
                    </div>

                    <h3 className="font-bold text-sm text-white">{item.title}</h3>

                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt={item.title} className="w-full h-56 object-cover rounded-xl border border-slate-800" />
                    ) : (
                      <div className="w-full h-56 bg-gradient-to-tr from-indigo-950 via-purple-900 to-slate-900 rounded-xl flex flex-col items-center justify-center p-6 text-center border border-indigo-500/30">
                        <Sparkles className="w-8 h-8 text-indigo-400 mb-2" />
                        <p className="text-xs text-indigo-200 font-medium">{item.title}</p>
                      </div>
                    )}

                    <p className="text-[11px] text-slate-500 italic truncate">Prompt: {item.promptUsed}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {activeTab === 'analytics' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-1">
                <span className="text-xs text-slate-400 uppercase font-semibold">Total Queued Items</span>
                <p className="text-2xl font-bold text-white">{tasks.length}</p>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-1">
                <span className="text-xs text-slate-400 uppercase font-semibold">Completed Actions</span>
                <p className="text-2xl font-bold text-emerald-400">{completedCount}</p>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-1">
                <span className="text-xs text-slate-400 uppercase font-semibold">Cognitive Load</span>
                <p className="text-2xl font-bold text-blue-400">{totalMins} mins</p>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-1">
                <span className="text-xs text-slate-400 uppercase font-semibold">Neuro Alignment</span>
                <p className="text-2xl font-bold text-amber-400">92%</p>
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-blue-400" /> Life Spectrum Domain Distribution
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {Object.entries(DOMAINS).map(([key, domain]) => {
                  const domainTasks = tasks.filter(t => t.domain === key);
                  const count = domainTasks.length;
                  const mins = domainTasks.reduce((acc, t) => acc + (t.timeEstimate || 0), 0);
                  const Icon = domain.icon;

                  return (
                    <div key={key} className="bg-slate-950 p-4 rounded-xl border border-slate-800/80 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className={`p-2 rounded-lg border ${domain.color}`}>
                            <Icon className="w-4 h-4" />
                          </div>
                          <span className="font-semibold text-sm text-slate-200">{domain.name}</span>
                        </div>
                        <span className="text-xs text-slate-400 font-mono">{count} items ({mins}m)</span>
                      </div>
                      <div className="w-full bg-slate-900 rounded-full h-2 overflow-hidden border border-slate-800">
                        <div 
                          className={`h-full bg-gradient-to-r ${domain.accent}`} 
                          style={{ width: `${tasks.length ? (count / tasks.length) * 100 : 0}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

      </main>

      {activeTimerTask && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 text-center space-y-6 shadow-2xl relative">
            <button 
              onClick={() => { setActiveTimerTask(null); setIsTimerActive(false); }} 
              className="absolute top-4 right-4 text-slate-400 hover:text-white"
            >
              ✕
            </button>

            <span className={`px-2.5 py-1 rounded text-xs font-bold border ${DOMAINS[activeTimerTask.domain]?.color}`}>
              {DOMAINS[activeTimerTask.domain]?.name}
            </span>

            <h2 className="text-lg font-bold text-white">{activeTimerTask.title}</h2>

            <div className="py-6 font-mono text-5xl font-extrabold text-amber-400 bg-slate-950 rounded-2xl border border-slate-800 tracking-wider">
              {formatTimerDisplay(timerSecondsLeft)}
            </div>

            <div className="flex gap-3">
              <button 
                onClick={() => setIsTimerActive(!isTimerActive)}
                className="flex-1 py-3 bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs rounded-xl flex items-center justify-center gap-2 transition"
              >
                {isTimerActive ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                <span>{isTimerActive ? 'Pause Session' : 'Resume Session'}</span>
              </button>
              <button 
                onClick={() => {
                  toggleTaskStatus(activeTimerTask.id);
                  setActiveTimerTask(null);
                  setIsTimerActive(false);
                }}
                className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs rounded-xl flex items-center justify-center gap-2 transition"
              >
                <Check className="w-4 h-4" />
                <span>Mark Done</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form onSubmit={handleCreateManualTask} className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Plus className="w-4 h-4 text-blue-400" /> Create Custom Action
              </h3>
              <button type="button" onClick={() => setIsAddModalOpen(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">Task Title</label>
              <input 
                type="text" 
                required
                value={manualTaskForm.title}
                onChange={(e) => setManualTaskForm({...manualTaskForm, title: e.target.value})}
                placeholder="e.g., Draft project specs"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Domain</label>
                <select 
                  value={manualTaskForm.domain}
                  onChange={(e) => setManualTaskForm({...manualTaskForm, domain: e.target.value})}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white"
                >
                  {Object.entries(DOMAINS).map(([k, v]) => (
                    <option key={k} value={k}>{v.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Energy State</label>
                <select 
                  value={manualTaskForm.energy}
                  onChange={(e) => setManualTaskForm({...manualTaskForm, energy: e.target.value})}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white"
                >
                  {Object.entries(ENERGY_LEVELS).map(([k, v]) => (
                    <option key={k} value={k}>{v.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Duration (Mins)</label>
                <input 
                  type="number" 
                  min="5"
                  max="240"
                  value={manualTaskForm.timeEstimate}
                  onChange={(e) => setManualTaskForm({...manualTaskForm, timeEstimate: e.target.value})}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Priority (1-10)</label>
                <input 
                  type="number" 
                  min="1"
                  max="10"
                  value={manualTaskForm.priority}
                  onChange={(e) => setManualTaskForm({...manualTaskForm, priority: e.target.value})}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">Cognitive Context / Note</label>
              <input 
                type="text" 
                value={manualTaskForm.aiContext}
                onChange={(e) => setManualTaskForm({...manualTaskForm, aiContext: e.target.value})}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white"
              />
            </div>

            <button 
              type="submit"
              className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs rounded-xl transition shadow-md mt-2"
            >
              Add Action Item
            </button>
          </form>
        </div>
      )}

      {editingTask && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form onSubmit={handleSaveEditedTask} className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Edit3 className="w-4 h-4 text-blue-400" /> Edit Action Item
              </h3>
              <button type="button" onClick={() => setEditingTask(null)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">Task Title</label>
              <input 
                type="text" 
                required
                value={editingTask.title}
                onChange={(e) => setEditingTask({...editingTask, title: e.target.value})}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Domain</label>
                <select 
                  value={editingTask.domain}
                  onChange={(e) => setEditingTask({...editingTask, domain: e.target.value})}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white"
                >
                  {Object.entries(DOMAINS).map(([k, v]) => (
                    <option key={k} value={k}>{v.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Energy State</label>
                <select 
                  value={editingTask.energy}
                  onChange={(e) => setEditingTask({...editingTask, energy: e.target.value})}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white"
                >
                  {Object.entries(ENERGY_LEVELS).map(([k, v]) => (
                    <option key={k} value={k}>{v.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Duration (Mins)</label>
                <input 
                  type="number" 
                  value={editingTask.timeEstimate}
                  onChange={(e) => setEditingTask({...editingTask, timeEstimate: Number(e.target.value)})}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Priority (1-10)</label>
                <input 
                  type="number" 
                  value={editingTask.priority}
                  onChange={(e) => setEditingTask({...editingTask, priority: Number(e.target.value)})}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white"
                />
              </div>
            </div>

            <button 
              type="submit"
              className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs rounded-xl transition shadow-md mt-2"
            >
              Save Changes
            </button>
          </form>
        </div>
      )}

      {isSettingsOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Brain className="w-5 h-5 text-blue-400" />
                <h3 className="text-base font-bold text-white">Gemini Engine Settings</h3>
              </div>
              <button onClick={() => setIsSettingsOpen(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <div className="space-y-3">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-300">
                Google Gemini API Key
              </label>
              <input 
                type="password"
                value={tempApiKey}
                onChange={(e) => setTempApiKey(e.target.value)}
                placeholder="Optional (Uses environment proxy when blank)"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="pt-2 border-t border-slate-800 space-y-3">
              <span className="block text-xs font-bold uppercase tracking-wider text-slate-400">
                Data Management
              </span>
              <div className="flex gap-2">
                <button 
                  onClick={exportData}
                  className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl flex items-center justify-center gap-2 border border-slate-700"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export JSON</span>
                </button>
                <label className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl flex items-center justify-center gap-2 border border-slate-700 cursor-pointer">
                  <Upload className="w-3.5 h-3.5" />
                  <span>Import JSON</span>
                  <input type="file" accept=".json" onChange={importData} className="hidden" />
                </label>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button 
                onClick={() => {
                  setApiKey(tempApiKey);
                  setIsSettingsOpen(false);
                  triggerToast('Settings updated successfully.');
                }}
                className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-xl transition shadow-md"
              >
                Save Settings
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}