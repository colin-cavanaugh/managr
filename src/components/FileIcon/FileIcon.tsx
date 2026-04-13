import { getIconForFile, getIconForFolder, getIconForOpenFolder } from 'vscode-icons-js'

// Import all downloaded VSCode icons
const iconModules = import.meta.glob('../../assets/file-icons/*.svg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>

// Build a lookup map: 'file_type_pdf.svg' → '/assets/file_type_pdf-xxxxx.svg'
const iconMap: Record<string, string> = {}
for (const [path, url] of Object.entries(iconModules)) {
  const filename = path.split('/').pop() ?? ''
  iconMap[filename] = url
}

interface FileIconProps {
  name: string
  isDirectory: boolean
  isOpen?: boolean
  size?: number
  className?: string
}

export function FileIcon({ name, isDirectory, isOpen = false, size = 22, className = '' }: FileIconProps) {
  let iconName: string | undefined

  if (isDirectory) {
    iconName = isOpen ? getIconForOpenFolder(name) : getIconForFolder(name)
    // Fallback to default folder icons
    if (!iconName || !iconMap[iconName]) {
      iconName = isOpen ? 'default_folder_opened.svg' : 'default_folder.svg'
    }
  } else {
    iconName = getIconForFile(name)
    if (!iconName || !iconMap[iconName]) {
      iconName = 'default_file.svg'
    }
  }

  const src = iconMap[iconName]

  if (src) {
    return (
      <img
        src={src}
        alt={name}
        width={size}
        height={size}
        className={className}
        style={{ objectFit: 'contain', flexShrink: 0 }}
      />
    )
  }

  // Ultimate fallback
  return (
    <span className={className} style={{ fontSize: size * 0.7, display: 'flex', alignItems: 'center', justifyContent: 'center', width: size, height: size }}>
      {isDirectory ? '📁' : '📄'}
    </span>
  )
}

// ─── Drive icon ─────────────────────────────────────────────────────────────

interface DriveIconProps {
  driveType: 'drive' | 'mount' | 'home'
  label: string
  size?: number
  className?: string
}

export function DriveIcon({ driveType, label, size = 18, className = '' }: DriveIconProps) {
  const lowerLabel = label.toLowerCase()

  let iconName: string
  if (lowerLabel.includes('ubuntu') || lowerLabel.includes('linux') || driveType === 'mount') {
    iconName = 'folder_type_linux.svg'
  } else if (driveType === 'home') {
    iconName = 'folder_type_windows.svg'
  } else {
    iconName = 'folder_type_dist.svg'
  }

  const src = iconMap[iconName]

  if (src) {
    return (
      <img
        src={src}
        alt={label}
        width={size}
        height={size}
        className={className}
        style={{ objectFit: 'contain', flexShrink: 0 }}
      />
    )
  }

  return <span style={{ fontSize: size * 0.7 }}>{driveType === 'drive' ? '💾' : driveType === 'mount' ? '🐧' : '🏠'}</span>
}
