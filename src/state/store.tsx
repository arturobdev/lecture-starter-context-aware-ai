import { createContext, useContext, useState, useEffect, type ReactNode, type Dispatch, type SetStateAction } from 'react';
import { DEFAULT_MEMORY_CONFIG, type MemoryConfig } from '../memory/memory-manager';

export type ModelStatus = 'idle' | 'loading' | 'ready' | 'error';
export type EmbedStatus = 'idle' | 'initializing' | 'ready' | 'error' | 'embedding';

export interface ModelProgress {
  progress: number;
  text: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface MemoryStats {
  messageCount: number;
  summaryCount: number;
  factCount: number;
  embeddingCount: number;
}

interface AppState {
  currentThreadId: string;
  isOnline: boolean;
  modelStatus: ModelStatus;
  setModelStatus: (status: ModelStatus) => void;
  modelProgress: ModelProgress;
  setModelProgress: (progress: ModelProgress) => void;
  isGenerating: boolean;
  setIsGenerating: (generating: boolean) => void;
  currentStreamedMessage: string;
  setCurrentStreamedMessage: Dispatch<SetStateAction<string>>;
  webGPUAvailable: boolean | null;
  lastTokenUsage: TokenUsage | null;
  setLastTokenUsage: (usage: TokenUsage | null) => void;
  embedStatus: EmbedStatus;
  setEmbedStatus: (status: EmbedStatus) => void;
  embedDevice: 'webgpu' | 'wasm' | null;
  setEmbedDevice: (device: 'webgpu' | 'wasm' | null) => void;
  memoryConfig: MemoryConfig;
  setMemoryConfig: (config: MemoryConfig) => void;
  showMemoryInspector: boolean;
  setShowMemoryInspector: (show: boolean) => void;
  maxInputTokens: number;
  setMaxInputTokens: (tokens: number) => void;
  memoryStats: MemoryStats;
  setMemoryStats: (stats: MemoryStats) => void;
}

const AppStateContext = createContext<AppState | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [currentThreadId] = useState('default-thread');
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [modelStatus, setModelStatus] = useState<ModelStatus>('idle');
  const [modelProgress, setModelProgress] = useState<ModelProgress>({ progress: 0, text: '' });
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentStreamedMessage, setCurrentStreamedMessage] = useState('');
  const [webGPUAvailable, setWebGPUAvailable] = useState<boolean | null>(null);
  const [lastTokenUsage, setLastTokenUsage] = useState<TokenUsage | null>(null);
  const [embedStatus, setEmbedStatus] = useState<EmbedStatus>('idle');
  const [embedDevice, setEmbedDevice] = useState<'webgpu' | 'wasm' | null>(null);
  const [memoryConfig, setMemoryConfig] = useState<MemoryConfig>(DEFAULT_MEMORY_CONFIG);
  const [showMemoryInspector, setShowMemoryInspector] = useState(false);
  const [maxInputTokens, setMaxInputTokens] = useState(2000);
  const [memoryStats, setMemoryStats] = useState<MemoryStats>({
    messageCount: 0,
    summaryCount: 0,
    factCount: 0,
    embeddingCount: 0,
  });

  // Check WebGPU availability on mount
  useEffect(() => {
    const checkWebGPU = async () => {
      if ('gpu' in navigator) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const gpu = (navigator as any).gpu;
          if (gpu) {
            const adapter = await gpu.requestAdapter();
            setWebGPUAvailable(!!adapter);
          } else {
            setWebGPUAvailable(false);
          }
        } catch {
          setWebGPUAvailable(false);
        }
      } else {
        setWebGPUAvailable(false);
      }
    };
    checkWebGPU();
  }, []);

  // Track online/offline status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const value: AppState = {
    currentThreadId,
    isOnline,
    modelStatus,
    setModelStatus,
    modelProgress,
    setModelProgress,
    isGenerating,
    setIsGenerating,
    currentStreamedMessage,
    setCurrentStreamedMessage,
    webGPUAvailable,
    lastTokenUsage,
    setLastTokenUsage,
    embedStatus,
    setEmbedStatus,
    embedDevice,
    setEmbedDevice,
    memoryConfig,
    setMemoryConfig,
    showMemoryInspector,
    setShowMemoryInspector,
    maxInputTokens,
    setMaxInputTokens,
    memoryStats,
    setMemoryStats,
  };

  return (
    <AppStateContext.Provider value={value}>
      {children}
    </AppStateContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAppState() {
  const context = useContext(AppStateContext);
  if (!context) {
    throw new Error('useAppState must be used within AppStateProvider');
  }
  return context;
}
