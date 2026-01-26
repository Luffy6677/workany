import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ImageLogo from '@/assets/logo.png';
import { API_BASE_URL } from '@/config';
import type { Task } from '@/shared/db';
import { getSettings, type UserProfile } from '@/shared/db/settings';
import { cn } from '@/shared/lib/utils';
import { getDirectoryHandle, getHandleByName } from '@/shared/lib/working-directory-store';
import { useLanguage } from '@/shared/providers/language-provider';
import {
  ArrowLeft,
  ChevronsUpDown,
  Cloud,
  File,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType,
  Folder,
  FolderOpen,
  ListTodo,
  Loader2,
  MoreHorizontal,
  Music,
  PanelLeft,
  PanelLeftOpen,
  Presentation,
  Settings,
  SquarePen,
  Star,
  Table,
  Trash2,
  Type,
  User,
  Video,
} from 'lucide-react';

import type { Artifact, ArtifactType } from '@/components/artifacts';
import { SettingsModal } from '@/components/settings';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { AppMode } from '@/shared/db';

import { useSidebar } from './sidebar-context';

const API_URL = API_BASE_URL;

// Workspace-related types
interface WorkingFile {
  name: string;
  path: string;
  isDir: boolean;
  children?: WorkingFile[];
  isExpanded?: boolean;
}

// Working directory info - supports both path (Tauri) and handle key (Web)
interface WorkingDirectoryInfo {
  name: string;
  path?: string; // Available in Tauri
  handleKey?: string; // Key to retrieve FileSystemDirectoryHandle from global store (Web)
}

interface WorkspaceProps {
  sessionFolder?: string;
  artifacts?: Artifact[];
  onSelectArtifact?: (artifact: Artifact) => void;
  onFilesChanged?: () => void;
  workingDirectory?: WorkingDirectoryInfo | null; // User-selected local working directory
}

interface LeftSidebarProps {
  tasks: Task[];
  currentTaskId?: string;
  onDeleteTask?: (taskId: string) => void;
  onToggleFavorite?: (taskId: string, favorite: boolean) => void;
  runningTaskIds?: string[]; // Tasks running in background
  // Workspace mode props
  mode?: 'tasks' | 'workspace';
  workspaceProps?: WorkspaceProps;
  // App mode (Work/Code) - only shown in Home page (mode !== 'workspace')
  appMode?: AppMode;
  onAppModeChange?: (mode: AppMode) => void;
}

// Get file icon based on file extension
function getFileIconByExt(ext?: string) {
  if (!ext) return File;
  switch (ext) {
    case 'html':
    case 'htm':
      return FileCode2;
    case 'js':
    case 'jsx':
    case 'ts':
    case 'tsx':
      return FileCode2;
    case 'css':
    case 'scss':
    case 'less':
      return FileCode2;
    case 'json':
      return FileText;
    case 'md':
    case 'markdown':
      return FileType;
    case 'csv':
      return Table;
    case 'xlsx':
    case 'xls':
      return FileSpreadsheet;
    case 'pptx':
    case 'ppt':
      return Presentation;
    case 'docx':
    case 'doc':
      return FileText;
    case 'pdf':
      return FileText;
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'webp':
    case 'bmp':
    case 'ico':
      return FileImage;
    case 'mp3':
    case 'wav':
    case 'ogg':
    case 'm4a':
    case 'aac':
    case 'flac':
    case 'wma':
    case 'aud':
    case 'aiff':
    case 'mid':
    case 'midi':
      return Music;
    case 'mp4':
    case 'webm':
    case 'mov':
    case 'avi':
    case 'mkv':
    case 'm4v':
    case 'wmv':
    case 'flv':
    case '3gp':
      return Video;
    case 'ttf':
    case 'otf':
    case 'woff':
    case 'woff2':
    case 'eot':
      return Type;
    case 'py':
    case 'rb':
    case 'go':
    case 'rs':
    case 'java':
    case 'c':
    case 'cpp':
    case 'h':
      return FileCode2;
    default:
      return File;
  }
}

// Get artifact type based on file extension
function getArtifactTypeByExt(ext?: string): ArtifactType {
  if (!ext) return 'text';
  switch (ext) {
    case 'html':
    case 'htm':
      return 'html';
    case 'jsx':
    case 'tsx':
      return 'jsx';
    case 'css':
    case 'scss':
    case 'less':
      return 'css';
    case 'json':
      return 'json';
    case 'md':
    case 'markdown':
      return 'markdown';
    case 'csv':
      return 'csv';
    case 'xlsx':
    case 'xls':
      return 'spreadsheet';
    case 'pptx':
    case 'ppt':
      return 'presentation';
    case 'docx':
    case 'doc':
      return 'document';
    case 'pdf':
      return 'pdf';
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'webp':
    case 'bmp':
    case 'ico':
      return 'image';
    case 'mp3':
    case 'wav':
    case 'ogg':
    case 'm4a':
    case 'aac':
    case 'flac':
    case 'wma':
    case 'aud':
    case 'aiff':
    case 'mid':
    case 'midi':
      return 'audio';
    case 'mp4':
    case 'webm':
    case 'mov':
    case 'avi':
    case 'mkv':
    case 'm4v':
    case 'wmv':
    case 'flv':
    case '3gp':
      return 'video';
    case 'ttf':
    case 'otf':
    case 'woff':
    case 'woff2':
    case 'eot':
      return 'font';
    default:
      return 'code';
  }
}

// Read directory via API
async function readDirViaApi(dirPath: string): Promise<WorkingFile[]> {
  try {
    const response = await fetch(`${API_URL}/files/readdir`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path: dirPath, maxDepth: 3 }),
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json();

    if (!data.files || !Array.isArray(data.files)) {
      return [];
    }

    // Convert API response to WorkingFile format with isExpanded
    function addExpandedFlag(files: WorkingFile[], depth = 0): WorkingFile[] {
      return files.map((file) => ({
        ...file,
        isExpanded: false,
        children: file.children
          ? addExpandedFlag(file.children, depth + 1)
          : undefined,
      }));
    }

    return addExpandedFlag(data.files);
  } catch {
    return [];
  }
}

// Workspace Section Component
// Displays artifacts (files created by agent), user-uploaded files, and working directory files
function WorkspaceSection({
  sessionFolder,
  onSelectArtifact,
  artifacts = [],
  onFilesChanged,
  onOpenFilePicker,
  workingDirectory,
}: {
  sessionFolder?: string;
  onSelectArtifact?: (artifact: Artifact) => void;
  artifacts?: Artifact[];
  onFilesChanged?: () => void;
  onOpenFilePicker?: (openFn: () => void, isUploading: boolean) => void;
  workingDirectory?: WorkingDirectoryInfo | null;
}) {
  const { t } = useLanguage();
  const [uploadedFiles, setUploadedFiles] = useState<Artifact[]>([]);
  const [workingDirFiles, setWorkingDirFiles] = useState<Artifact[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [refreshCounter, setRefreshCounter] = useState(0); // Local counter to trigger refresh after upload
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Compute uploads directory path
  const uploadsDir = sessionFolder ? `${sessionFolder}/uploads` : undefined;

  // Load uploaded files from the uploads directory
  useEffect(() => {
    let cancelled = false;

    async function loadUploadedFiles() {
      if (!uploadsDir) {
        setUploadedFiles([]);
        return;
      }

      try {
        const files = await readDirViaApi(uploadsDir);
        if (cancelled) return;

        // Convert to Artifact format
        const uploadArtifacts: Artifact[] = files
          .filter((f) => !f.isDir)
          .map((f) => {
            const ext = f.name.split('.').pop()?.toLowerCase();
            return {
              id: f.path,
              name: f.name,
              type: getArtifactTypeByExt(ext),
              path: f.path,
            };
          });

        setUploadedFiles(uploadArtifacts);
      } catch {
        if (!cancelled) {
          setUploadedFiles([]);
        }
      }
    }

    loadUploadedFiles();

    return () => {
      cancelled = true;
    };
  }, [uploadsDir, artifacts.length, refreshCounter]); // Also refresh when refreshCounter changes

  // Load files from working directory (user-selected local folder)
  useEffect(() => {
    let cancelled = false;

    console.log('[WorkspaceSection] useEffect triggered, workingDirectory:', workingDirectory);

    async function loadWorkingDirFiles() {
      if (!workingDirectory) {
        console.log('[WorkspaceSection] workingDirectory is null/undefined');
        setWorkingDirFiles([]);
        return;
      }

      console.log('[WorkspaceSection] Loading files from workingDirectory:', workingDirectory);

      try {
        let workingArtifacts: Artifact[] = [];

        if (workingDirectory.path) {
          // Tauri environment: use API to read directory
          const files = await readDirViaApi(workingDirectory.path);
          if (cancelled) return;

          workingArtifacts = files
            .filter((f) => !f.isDir)
            .map((f) => {
              const ext = f.name.split('.').pop()?.toLowerCase();
              return {
                id: `wd-${f.path}`,
                name: f.name,
                type: getArtifactTypeByExt(ext),
                path: f.path,
              };
            });
        } else if (workingDirectory.handleKey || workingDirectory.name) {
          // Web environment: retrieve FileSystemDirectoryHandle from global store
          // Try by handleKey first, then fall back to retrieving by name from IndexedDB
          let dirHandle: FileSystemDirectoryHandle | undefined;

          if (workingDirectory.handleKey) {
            dirHandle = getDirectoryHandle(workingDirectory.handleKey);
          }

          // If not found by key, try to retrieve by folder name from IndexedDB
          if (!dirHandle && workingDirectory.name) {
            console.log('[WorkspaceSection] Handle not found by key, trying to retrieve by name:', workingDirectory.name);
            dirHandle = await getHandleByName(workingDirectory.name);
          }

          if (!dirHandle) {
            console.error('[WorkspaceSection] Directory handle not found for:', workingDirectory.handleKey || workingDirectory.name);
            return;
          }

          console.log('[WorkspaceSection] Got dirHandle, iterating entries...');
          const entries: Artifact[] = [];
          // Use values() method to iterate directory entries
          // TypeScript doesn't have complete types for File System Access API
          const asyncIterator = (dirHandle as unknown as { values(): AsyncIterable<FileSystemHandle> }).values();
          for await (const entry of asyncIterator) {
            console.log('[WorkspaceSection] Found entry:', entry.name, entry.kind);
            if (entry.kind === 'file') {
              const ext = entry.name.split('.').pop()?.toLowerCase();
              entries.push({
                id: `wd-${entry.name}`,
                name: entry.name,
                type: getArtifactTypeByExt(ext),
                // Store the handle key for later file access
                handleKey: workingDirectory.handleKey,
              } as Artifact & { handleKey?: string });
            }
          }
          console.log('[WorkspaceSection] Finished iterating, found', entries.length, 'files');
          if (cancelled) return;
          workingArtifacts = entries;
        }

        console.log('[WorkspaceSection] Setting workingDirFiles:', workingArtifacts.length, 'files');
        setWorkingDirFiles(workingArtifacts);
      } catch (error) {
        console.error('[WorkspaceSection] Failed to load working directory files:', error);
        if (!cancelled) {
          setWorkingDirFiles([]);
        }
      }
    }

    loadWorkingDirFiles();

    return () => {
      cancelled = true;
    };
  }, [workingDirectory]);

  // Merge artifacts, uploaded files, and working directory files
  const allFiles = useMemo(() => {
    const seenIds = new Set<string>();
    const result: Artifact[] = [];

    // Add working directory files first (user's local files)
    // These may not have path (Web environment), use id as unique key
    for (const file of workingDirFiles) {
      const key = file.path || file.id;
      if (key && !seenIds.has(key)) {
        seenIds.add(key);
        result.push(file);
      }
    }

    // Add artifacts (agent-generated files)
    for (const artifact of artifacts) {
      const key = artifact.path || artifact.id;
      if (key && !seenIds.has(key)) {
        seenIds.add(key);
        result.push(artifact);
      }
    }

    // Add uploaded files
    for (const file of uploadedFiles) {
      const key = file.path || file.id;
      if (key && !seenIds.has(key)) {
        seenIds.add(key);
        result.push(file);
      }
    }

    console.log('[WorkspaceSection] allFiles computed:', result.length, 'files');
    return result;
  }, [artifacts, uploadedFiles, workingDirFiles]);

  // Load file content and then select artifact
  const handleSelectArtifact = async (artifact: Artifact) => {
    if (!onSelectArtifact) return;

    // For text-based files, load content from path if not already present
    const textTypes = ['markdown', 'code', 'text', 'json', 'css', 'html', 'jsx'];
    const needsContent = textTypes.includes(artifact.type) && !artifact.content && artifact.path;

    if (needsContent) {
      try {
        const response = await fetch(`${API_URL}/files/read`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: artifact.path }),
        });

        if (response.ok) {
          const data = await response.json();
          if (data.content) {
            // Create artifact with loaded content
            onSelectArtifact({ ...artifact, content: data.content });
            return;
          }
        }
      } catch (err) {
        console.error('[Workspace] Failed to load file content:', err);
      }
    }

    // Fallback: select artifact as-is
    onSelectArtifact(artifact);
  };

  // Handle file input change (using browser's file input, same as ChatInput)
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !uploadsDir) return;

    setIsUploading(true);

    try {
      for (const file of Array.from(files)) {
        // Read file as base64
        const reader = new FileReader();
        const base64Promise = new Promise<string>((resolve, reject) => {
          reader.onload = () => {
            const result = reader.result as string;
            // Remove data URL prefix to get pure base64
            const base64 = result.includes(',') ? result.split(',')[1] : result;
            resolve(base64);
          };
          reader.onerror = () => reject(reader.error);
        });
        reader.readAsDataURL(file);

        const base64Content = await base64Promise;

        // Save file via API
        const response = await fetch(`${API_URL}/files/write-binary`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            path: `${uploadsDir}/${file.name}`,
            content: base64Content,
          }),
        });

        if (!response.ok) {
          console.error('[Workspace] Failed to save file:', file.name);
        }
      }

      // Trigger local refresh to reload uploaded files
      setRefreshCounter((c) => c + 1);

      // Notify parent to refresh
      if (onFilesChanged) {
        onFilesChanged();
      }
    } catch (err) {
      console.error('[Workspace] Error uploading files:', err);
    } finally {
      setIsUploading(false);
      // Reset input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Open file picker
  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  // Expose file picker to parent
  useEffect(() => {
    if (onOpenFilePicker && sessionFolder) {
      onOpenFilePicker(openFilePicker, isUploading);
    }
  }, [onOpenFilePicker, sessionFolder, isUploading]);

  return (
    <div className="flex flex-col">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Files list - flat structure */}
      {allFiles.length === 0 ? (
        <div className="flex items-center gap-2 px-2 py-2">
          <div className="bg-sidebar-accent/30 rounded p-1.5">
            <Folder className="text-sidebar-foreground/40 size-3.5" />
          </div>
          <p className="text-sidebar-foreground/50 text-xs">
            {t.task.workspaceEmpty || 'No files yet'}
          </p>
        </div>
      ) : (
        <div className="max-h-[400px] space-y-0.5 overflow-y-auto px-2">
          {allFiles.map((artifact) => {
            const IconComponent = getFileIconByExt(
              artifact.name.split('.').pop()?.toLowerCase()
            );
            return (
              <button
                key={artifact.id}
                onClick={() => handleSelectArtifact(artifact)}
                className="hover:bg-sidebar-accent/50 flex w-full items-center gap-1.5 rounded-md py-1 pl-2 text-left transition-colors"
              >
                <IconComponent className="text-sidebar-foreground/60 size-3.5 shrink-0" />
                <span className="text-sidebar-foreground/80 truncate text-sm">
                  {artifact.name}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Delete confirmation dialog component
function DeleteConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  t,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  t: ReturnType<typeof useLanguage>['t'];
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={() => onOpenChange(false)}
      />
      <div className="bg-background border-border relative w-[400px] max-w-[90vw] rounded-lg border p-6 shadow-xl">
        <h3 className="text-foreground text-lg font-semibold">
          {t.common.deleteTaskConfirm}
        </h3>
        <p className="text-muted-foreground mt-2 text-sm">
          {t.common.deleteTaskDescription}
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={() => onOpenChange(false)}
            className="border-border hover:bg-accent rounded-lg border px-4 py-2 text-sm transition-colors"
          >
            {t.common.cancel}
          </button>
          <button
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
            className="rounded-lg bg-red-500 px-4 py-2 text-sm text-white transition-colors hover:bg-red-600"
          >
            {t.common.delete}
          </button>
        </div>
      </div>
    </div>
  );
}

// Get icon for task based on working directory (Cloud vs Local Folder)
function getTaskIcon(task: Task) {
  // Differentiate by working directory
  // If workingDirectory is set, it's a local folder task
  // If not set (null/undefined), it's a cloud environment task
  if (task.workingDirectory) {
    return FolderOpen; // Local folder icon
  }
  return Cloud; // Cloud environment icon
}

// Mode Switcher Component
function ModeSwitcher({
  appMode,
  onModeChange,
  collapsed,
}: {
  appMode: AppMode;
  onModeChange: (mode: AppMode) => void;
  collapsed: boolean;
}) {
  const { t } = useLanguage();

  if (collapsed) {
    // In collapsed state, show a simple indicator with tooltip
    return (
      <div className="flex flex-col items-center gap-1 px-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => onModeChange(appMode === 'work' ? 'code' : 'work')}
              className="bg-sidebar-accent/50 text-sidebar-foreground hover:bg-sidebar-accent flex size-10 cursor-pointer items-center justify-center rounded-xl text-xs font-medium transition-colors"
            >
              {appMode === 'work' ? 'W' : 'C'}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">
            <div className="flex flex-col gap-1">
              <span className="font-medium">
                {appMode === 'work' ? (t.nav.workMode || 'Work') : (t.nav.codeMode || 'Code')}
              </span>
              <span className="text-muted-foreground text-xs">
                {t.nav.clickToSwitch || 'Click to switch'}
              </span>
            </div>
          </TooltipContent>
        </Tooltip>
      </div>
    );
  }

  // Expanded state - pill switcher
  return (
    <div className="px-3 py-2">
      <div className="bg-sidebar-accent/30 flex rounded-xl p-1">
        <button
          onClick={() => onModeChange('work')}
          className={cn(
            'flex-1 rounded-lg px-4 py-1.5 text-sm font-medium transition-all duration-200',
            appMode === 'work'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-sidebar-foreground/60 hover:text-sidebar-foreground'
          )}
        >
          {t.nav.workMode || 'Work'}
        </button>
        <button
          onClick={() => onModeChange('code')}
          className={cn(
            'flex-1 rounded-lg px-4 py-1.5 text-sm font-medium transition-all duration-200',
            appMode === 'code'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-sidebar-foreground/60 hover:text-sidebar-foreground'
          )}
        >
          {t.nav.codeMode || 'Code'}
        </button>
      </div>
    </div>
  );
}

export function LeftSidebar({
  tasks,
  currentTaskId,
  onDeleteTask,
  onToggleFavorite,
  runningTaskIds = [],
  mode = 'tasks',
  workspaceProps,
  appMode = 'work',
  onAppModeChange,
}: LeftSidebarProps) {
  const navigate = useNavigate();
  const { leftOpen, toggleLeft } = useSidebar();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profile, setProfile] = useState<UserProfile>({
    nickname: 'Guest User',
    avatar: '',
  });
  const { t } = useLanguage();

  // Delete confirmation dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [taskToDelete, setTaskToDelete] = useState<string | null>(null);

  // Loading state for task switching
  const [loadingTaskId, setLoadingTaskId] = useState<string | null>(null);

  const handleDeleteClick = (taskId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setTaskToDelete(taskId);
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = () => {
    if (taskToDelete && onDeleteTask) {
      onDeleteTask(taskToDelete);
      // If deleting current task, navigate to home
      if (taskToDelete === currentTaskId) {
        navigate('/');
      }
    }
    setTaskToDelete(null);
  };

  const handleToggleFavorite = (task: Task, e: React.MouseEvent) => {
    e.stopPropagation();
    if (onToggleFavorite) {
      onToggleFavorite(task.id, !task.favorite);
    }
  };

  // Load profile from settings
  useEffect(() => {
    const settings = getSettings();
    setProfile(settings.profile);
  }, []);

  // Reload profile when settings modal closes
  useEffect(() => {
    if (!settingsOpen) {
      const settings = getSettings();
      setProfile(settings.profile);
    }
  }, [settingsOpen]);

  const handleNewTask = () => {
    navigate('/');
  };

  const handleSelectTask = (taskId: string) => {
    // Skip if already on this task or already loading
    if (taskId === currentTaskId || loadingTaskId) return;

    // Show loading state immediately
    setLoadingTaskId(taskId);

    // Use requestAnimationFrame to ensure UI updates before navigation
    requestAnimationFrame(() => {
      navigate(`/task/${taskId}`);
      // Clear loading state after a short delay (navigation should complete)
      setTimeout(() => setLoadingTaskId(null), 100);
    });
  };

  const handleSettings = () => {
    setSettingsOpen(true);
  };

  // Hover state for showing task list popup
  const [showTasksPopup, setShowTasksPopup] = useState(false);
  // Hover state for logo expand button
  const [logoHovered, setLogoHovered] = useState(false);
  // File picker state from WorkspaceSection - use ref to avoid infinite loop
  const filePickerStateRef = useRef<{
    openFilePicker: () => void;
    isUploading: boolean;
  } | null>(null);

  // Flag to keep popup open while file picker is active (use ref for synchronous update)
  const keepPopupOpenRef = useRef(false);

  // Stable callback for WorkspaceSection
  const handleOpenFilePicker = useCallback((openFn: () => void, _isUploading: boolean) => {
    filePickerStateRef.current = { openFilePicker: openFn, isUploading: _isUploading };
  }, []);

  // Handler for "Add File" button click - keeps popup open
  const handleAddFileClick = useCallback(() => {
    // Set ref synchronously BEFORE opening file picker
    keepPopupOpenRef.current = true;
    filePickerStateRef.current?.openFilePicker();

    // Reset after window regains focus (file picker closed/cancelled)
    const handleFocus = () => {
      // Small delay to allow file change event to fire first
      setTimeout(() => {
        keepPopupOpenRef.current = false;
      }, 500);
      window.removeEventListener('focus', handleFocus);
    };
    window.addEventListener('focus', handleFocus);
  }, []);

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          'border-sidebar-border bg-sidebar flex h-full shrink-0 flex-col border-none transition-all duration-300',
          leftOpen ? 'w-72' : 'w-14'
        )}
      >
        {leftOpen ? (
          <>
            {/* Expanded State */}
            {/* Logo & Toggle */}
            <div className="flex shrink-0 items-center justify-between gap-3 p-4">
              <div className="flex items-center gap-2.5">
                <div className="flex size-9 items-center justify-center rounded-xl">
                  <img
                    src={ImageLogo}
                    alt="SOLO-Demo"
                    className="text-primary size-9"
                  />
                </div>
                <span className="text-sidebar-foreground font-mono text-lg font-medium tracking-wide">
                  SOLO-Demo
                </span>
              </div>
              <button
                onClick={toggleLeft}
                className="text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground flex size-8 cursor-pointer items-center justify-center rounded-lg transition-colors duration-200"
              >
                <PanelLeft className="size-4" />
              </button>
            </div>

            {/* Mode Switcher - Only show in Home page (mode !== 'workspace') */}
            {mode !== 'workspace' && onAppModeChange && (
              <ModeSwitcher
                appMode={appMode}
                onModeChange={onAppModeChange}
                collapsed={false}
              />
            )}

            {/* Navigation Items */}
            <nav className="flex shrink-0 flex-col gap-1 px-3">
              <NavItem
                icon={mode === 'workspace' ? ArrowLeft : SquarePen}
                label={mode === 'workspace' ? t.nav.allTasks : t.nav.newTask}
                collapsed={false}
                onClick={handleNewTask}
              />
            </nav>

            {/* Separator between navigation and workspace (only in workspace mode) */}
            {mode === 'workspace' && (
              <div className="border-sidebar-border/50 mx-3 mt-3 border-t" />
            )}

            {/* Tasks Section or Workspace Section */}
            <div className="mt-4 flex min-h-0 flex-1 flex-col overflow-hidden px-3">
              {mode === 'workspace' ? (
                <>
                  <div className="flex shrink-0 items-center justify-between px-2 py-1.5">
                    <span className="text-muted-foreground text-xs font-medium">
                      {t.task.assets || 'Assets'}
                    </span>
                    {workspaceProps?.sessionFolder && (
                      <button
                        onClick={() => filePickerStateRef.current?.openFilePicker()}
                        className="text-sidebar-foreground/50 hover:text-sidebar-foreground flex items-center gap-1 text-xs transition-colors"
                      >
                        <span className="text-sm leading-none">+</span>
                        <span>{t.task.addFile || 'Add'}</span>
                      </button>
                    )}
                  </div>
                  <div className="scrollbar-hide mt-1 flex-1 overflow-y-auto">
                    <WorkspaceSection
                      sessionFolder={workspaceProps?.sessionFolder}
                      artifacts={workspaceProps?.artifacts}
                      onSelectArtifact={workspaceProps?.onSelectArtifact}
                      onFilesChanged={workspaceProps?.onFilesChanged}
                      onOpenFilePicker={handleOpenFilePicker}
                      workingDirectory={workspaceProps?.workingDirectory}
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="flex shrink-0 items-center justify-between px-2 py-1.5">
                    <span className="text-sidebar-foreground/50 text-xs font-medium tracking-wider">
                      {t.nav.allTasks}
                    </span>
                  </div>
                  <div className="scrollbar-hide mt-1 flex-1 space-y-0.5 overflow-y-auto">
                    {tasks.slice(0, 10).map((task) => {
                      const TaskIcon = getTaskIcon(task);
                      const isRunningInBackground = runningTaskIds.includes(
                        task.id
                      );
                      const isLoading = loadingTaskId === task.id;
                      return (
                        <div
                          key={task.id}
                          className={cn(
                            'group relative flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 transition-all duration-200',
                            currentTaskId === task.id || isLoading
                              ? 'bg-sidebar-accent text-sidebar-accent-foreground shadow-sm'
                              : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground',
                            isLoading && 'opacity-70'
                          )}
                          onClick={() => handleSelectTask(task.id)}
                        >
                          <div className="relative shrink-0">
                            {isLoading ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <TaskIcon className="size-4" />
                            )}
                            {/* Running indicator */}
                            {isRunningInBackground && !isLoading && (
                              <span className="absolute -top-0.5 -right-0.5 flex size-2">
                                <span className="absolute inline-flex size-full animate-ping rounded-full bg-green-400 opacity-75" />
                                <span className="relative inline-flex size-2 rounded-full bg-green-500" />
                              </span>
                            )}
                          </div>
                          <span className="min-w-0 flex-1 truncate text-sm">
                            {task.prompt}
                          </span>
                          {/* Running indicator for running tasks, dropdown menu for completed tasks */}
                          {isRunningInBackground ? (
                            <div className="flex size-6 shrink-0 items-center justify-center">
                              <Loader2 className="text-primary size-4 animate-spin" />
                            </div>
                          ) : (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  onClick={(e) => e.stopPropagation()}
                                  className="flex size-6 shrink-0 items-center justify-center rounded transition-all"
                                >
                                  {/* Show star when favorited (hide on hover), show menu icon on hover */}
                                  {task.favorite ? (
                                    <>
                                      <Star className="size-4 fill-amber-400 text-amber-400 group-hover:hidden" />
                                      <MoreHorizontal className="text-sidebar-foreground/40 hover:text-sidebar-foreground hidden size-4 group-hover:block" />
                                    </>
                                  ) : (
                                    <MoreHorizontal className="text-sidebar-foreground/40 hover:text-sidebar-foreground size-4 opacity-0 group-hover:opacity-100" />
                                  )}
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent
                                align="end"
                                sideOffset={4}
                                className="min-w-[140px]"
                              >
                                <DropdownMenuItem
                                  className="cursor-pointer"
                                  onClick={(e) => handleToggleFavorite(task, e)}
                                >
                                  <Star
                                    className={cn(
                                      'size-4',
                                      task.favorite &&
                                        'fill-amber-400 text-amber-400'
                                    )}
                                  />
                                  <span>
                                    {task.favorite
                                      ? t.common.unfavorite
                                      : t.common.favorite}
                                  </span>
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="cursor-pointer text-red-500 focus:text-red-500"
                                  onClick={(e) => handleDeleteClick(task.id, e)}
                                >
                                  <Trash2 className="size-4" />
                                  <span>{t.common.delete}</span>
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>
                      );
                    })}
                    {tasks.length > 10 && (
                      <button
                        onClick={() => navigate('/library')}
                        className="text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 transition-colors"
                      >
                        <span className="text-sm">{t.common.more}</span>
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Bottom Section - Avatar with Dropdown */}
            <div className="border-sidebar-border mt-auto shrink-0 border-none p-3">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="hover:bg-sidebar-accent group flex w-full cursor-pointer items-center gap-3 rounded-lg p-2 transition-colors duration-200">
                    <div className="bg-sidebar-accent flex size-9 items-center justify-center overflow-hidden rounded-lg">
                      {profile.avatar ? (
                        <img
                          src={profile.avatar}
                          alt={profile.nickname}
                          className="size-full object-cover"
                        />
                      ) : (
                        <User className="text-sidebar-foreground/70 size-5" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1 text-left">
                      <p className="text-sidebar-foreground truncate text-sm font-medium">
                        {profile.nickname || 'Guest User'}
                      </p>
                    </div>
                    <ChevronsUpDown className="text-sidebar-foreground/40 group-hover:text-sidebar-foreground/60 size-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
                  side="right"
                  align="end"
                  sideOffset={8}
                >
                  <DropdownMenuLabel className="p-0 font-normal">
                    <div className="flex items-center gap-3 px-2 py-2 text-left">
                      <div className="bg-muted flex size-9 items-center justify-center overflow-hidden rounded-lg">
                        {profile.avatar ? (
                          <img
                            src={profile.avatar}
                            alt={profile.nickname}
                            className="size-full object-cover"
                          />
                        ) : (
                          <User className="text-muted-foreground size-5" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {profile.nickname || 'Guest User'}
                        </p>
                      </div>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      className="cursor-pointer"
                      onClick={handleSettings}
                    >
                      <Settings className="size-4" />
                      <span>{t.nav.settings}</span>
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </>
        ) : (
          <>
            {/* Collapsed State - Icon-only vertical bar */}
            {/* Logo with hover expand */}
            <div className="flex shrink-0 items-center justify-center p-3">
              <button
                onClick={toggleLeft}
                onMouseEnter={() => setLogoHovered(true)}
                onMouseLeave={() => setLogoHovered(false)}
                className="hover:bg-sidebar-accent relative flex size-9 cursor-pointer items-center justify-center rounded-xl transition-all duration-200"
              >
                {logoHovered ? (
                  <PanelLeftOpen className="text-sidebar-foreground size-5" />
                ) : (
                  <img src={ImageLogo} alt="SOLO-Demo" className="size-9" />
                )}
              </button>
            </div>

            {/* Mode Switcher - Only show in Home page (mode !== 'workspace') */}
            {mode !== 'workspace' && onAppModeChange && (
              <ModeSwitcher
                appMode={appMode}
                onModeChange={onAppModeChange}
                collapsed={true}
              />
            )}

            {/* Top Navigation Icons - Same as expanded */}
            <div className="flex shrink-0 flex-col items-center gap-1 px-2">
              {/* New Task or All Tasks (in workspace mode) */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={handleNewTask}
                    className="text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground flex size-10 cursor-pointer items-center justify-center rounded-xl transition-colors duration-200"
                  >
                    {mode === 'workspace' ? (
                      <ArrowLeft className="size-5" />
                    ) : (
                      <SquarePen className="size-5" />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  {mode === 'workspace' ? t.nav.allTasks : t.nav.newTask}
                </TooltipContent>
              </Tooltip>

              {/* Tasks or Workspace - With hover popup */}
              <div
                className="relative"
                onMouseEnter={() => setShowTasksPopup(true)}
                onMouseLeave={() => {
                  // Don't close if file picker is active (check ref for synchronous value)
                  if (!keepPopupOpenRef.current) {
                    setShowTasksPopup(false);
                  }
                }}
              >
                <button
                  className={cn(
                    'flex size-10 cursor-pointer items-center justify-center rounded-xl transition-colors duration-200',
                    mode === 'workspace' || currentTaskId
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                      : 'text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground'
                  )}
                >
                  {mode === 'workspace' ? (
                    <Folder className="size-5" />
                  ) : (
                    <ListTodo className="size-5" />
                  )}
                </button>

                {/* Popup Panel */}
                {showTasksPopup && (
                  <>
                    {/* Invisible bridge to prevent losing hover when moving to popup */}
                    <div className="absolute top-0 left-full z-50 h-full w-3" />
                    <div className="bg-background border-border/60 absolute top-0 left-full z-50 ml-2 max-h-[70vh] w-80 overflow-hidden rounded-xl border shadow-xl">
                      {/* Popup Header */}
                      <div className="border-border/50 bg-muted/30 flex items-center justify-between border-b px-4 py-3">
                        <h3 className="text-foreground text-sm font-medium">
                          {mode === 'workspace'
                            ? t.task.assets || 'Assets'
                            : t.nav.allTasks}
                        </h3>
                        {mode === 'workspace' && workspaceProps?.sessionFolder && (
                          <button
                            onClick={handleAddFileClick}
                            className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs transition-colors"
                          >
                            <span className="text-sm leading-none">+</span>
                            <span>{t.task.addFile || 'Add'}</span>
                          </button>
                        )}
                      </div>

                      {/* Content */}
                      <div className="max-h-[calc(70vh-48px)] overflow-y-auto p-2">
                        {mode === 'workspace' ? (
                          <WorkspaceSection
                            sessionFolder={workspaceProps?.sessionFolder}
                            artifacts={workspaceProps?.artifacts}
                            onSelectArtifact={workspaceProps?.onSelectArtifact}
                            onFilesChanged={workspaceProps?.onFilesChanged}
                            onOpenFilePicker={handleOpenFilePicker}
                          />
                        ) : tasks.length === 0 ? (
                          <div className="py-8 text-center">
                            <p className="text-muted-foreground text-sm">
                              {t.nav.noTasksYet}
                            </p>
                          </div>
                        ) : (
                          <div className="space-y-0.5">
                            {tasks.slice(0, 10).map((task) => {
                              const TaskIcon = getTaskIcon(task);
                              const isRunningInBackground =
                                runningTaskIds.includes(task.id);
                              const isLoading = loadingTaskId === task.id;
                              return (
                                <div
                                  key={task.id}
                                  className={cn(
                                    'group flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
                                    currentTaskId === task.id || isLoading
                                      ? 'bg-accent text-accent-foreground'
                                      : 'text-foreground/80 hover:bg-accent/50',
                                    isLoading && 'opacity-70'
                                  )}
                                  onClick={() => handleSelectTask(task.id)}
                                >
                                  <div className="relative shrink-0">
                                    {isLoading ? (
                                      <Loader2 className="text-muted-foreground size-5 animate-spin" />
                                    ) : (
                                      <TaskIcon className="text-muted-foreground size-5" />
                                    )}
                                    {/* Running indicator */}
                                    {isRunningInBackground && !isLoading && (
                                      <span className="absolute -top-0.5 -right-0.5 flex size-2">
                                        <span className="absolute inline-flex size-full animate-ping rounded-full bg-green-400 opacity-75" />
                                        <span className="relative inline-flex size-2 rounded-full bg-green-500" />
                                      </span>
                                    )}
                                  </div>
                                  <span className="min-w-0 flex-1 truncate text-sm">
                                    {task.prompt}
                                  </span>
                                  {/* Running indicator for running tasks, dropdown menu for completed tasks */}
                                  {isRunningInBackground ? (
                                    <div className="flex size-6 shrink-0 items-center justify-center">
                                      <Loader2 className="text-primary size-4 animate-spin" />
                                    </div>
                                  ) : (
                                    <DropdownMenu>
                                      <DropdownMenuTrigger asChild>
                                        <button
                                          onClick={(e) => e.stopPropagation()}
                                          className="flex size-6 shrink-0 items-center justify-center rounded transition-all"
                                        >
                                          {/* Show star when favorited (hide on hover), show menu icon on hover */}
                                          {task.favorite ? (
                                            <>
                                              <Star className="size-4 fill-amber-400 text-amber-400 group-hover:hidden" />
                                              <MoreHorizontal className="text-muted-foreground hover:text-foreground hidden size-4 group-hover:block" />
                                            </>
                                          ) : (
                                            <MoreHorizontal className="text-muted-foreground hover:text-foreground size-4 opacity-0 group-hover:opacity-100" />
                                          )}
                                        </button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent
                                        align="end"
                                        sideOffset={4}
                                        className="min-w-[140px]"
                                      >
                                        <DropdownMenuItem
                                          className="cursor-pointer"
                                          onClick={(e) =>
                                            handleToggleFavorite(task, e)
                                          }
                                        >
                                          <Star
                                            className={cn(
                                              'size-4',
                                              task.favorite &&
                                                'fill-amber-400 text-amber-400'
                                            )}
                                          />
                                          <span>
                                            {task.favorite
                                              ? t.common.unfavorite
                                              : t.common.favorite}
                                          </span>
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                          className="cursor-pointer text-red-500 focus:text-red-500"
                                          onClick={(e) =>
                                            handleDeleteClick(task.id, e)
                                          }
                                        >
                                          <Trash2 className="size-4" />
                                          <span>{t.common.delete}</span>
                                        </DropdownMenuItem>
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  )}
                                </div>
                              );
                            })}
                            {tasks.length > 10 && (
                              <button
                                onClick={() => navigate('/library')}
                                className="text-muted-foreground hover:text-foreground hover:bg-accent/50 flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 transition-colors"
                              >
                                <span className="text-sm">{t.common.more}</span>
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Spacer */}
            <div className="flex-1" />

            {/* Bottom - User Avatar with Dropdown */}
            <div className="flex shrink-0 flex-col items-center gap-1 px-2 pb-6">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="bg-sidebar-accent hover:ring-sidebar-foreground/20 flex size-8 cursor-pointer items-center justify-center overflow-hidden rounded-lg transition-all hover:ring-2">
                    {profile.avatar ? (
                      <img
                        src={profile.avatar}
                        alt={profile.nickname}
                        className="size-full object-cover"
                      />
                    ) : (
                      <User className="text-sidebar-foreground/70 size-4" />
                    )}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  className="min-w-56 rounded-lg"
                  side="right"
                  align="end"
                  sideOffset={8}
                >
                  {/* User Info Header */}
                  <DropdownMenuLabel className="p-0 font-normal">
                    <div className="flex items-center gap-3 px-2 py-2 text-left">
                      <div className="bg-muted flex size-9 items-center justify-center overflow-hidden rounded-lg">
                        {profile.avatar ? (
                          <img
                            src={profile.avatar}
                            alt={profile.nickname}
                            className="size-full object-cover"
                          />
                        ) : (
                          <User className="text-muted-foreground size-5" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {profile.nickname || 'Guest User'}
                        </p>
                      </div>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      className="cursor-pointer"
                      onClick={handleSettings}
                    >
                      <Settings className="size-4" />
                      <span>{t.nav.settings}</span>
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </>
        )}
      </aside>

      {/* Settings Modal */}
      <SettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} />

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={handleConfirmDelete}
        t={t}
      />
    </TooltipProvider>
  );
}

// Navigation Item Component
function NavItem({
  icon: Icon,
  label,
  collapsed,
  onClick,
  active,
  shortcut,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  collapsed: boolean;
  onClick?: () => void;
  active?: boolean;
  shortcut?: string;
}) {
  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onClick}
            className={cn(
              'mx-auto flex size-10 cursor-pointer items-center justify-center rounded-lg transition-all duration-200',
              active
                ? 'bg-sidebar-accent text-sidebar-accent-foreground shadow-sm'
                : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
            )}
          >
            <Icon className="size-5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">
          <div className="flex items-center gap-2">
            <span>{label}</span>
            {shortcut && (
              <span className="text-muted-foreground text-xs">{shortcut}</span>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all duration-200',
        active
          ? 'bg-sidebar-accent text-sidebar-accent-foreground font-semibold shadow-sm'
          : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
      )}
    >
      <Icon className="size-5" />
      <span className="flex-1 text-left">{label}</span>
      {shortcut && (
        <span className="text-sidebar-foreground/40 text-xs">{shortcut}</span>
      )}
    </button>
  );
}
