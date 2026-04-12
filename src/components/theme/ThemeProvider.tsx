import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import { defaultTheme, themeToVars, type ThemePalette } from './theme'

interface ThemeContextValue {
  theme: ThemePalette
  setTheme: (theme: ThemePalette) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

interface ThemeProviderProps {
  initialTheme?: ThemePalette
  children: ReactNode
}

export function ThemeProvider({ initialTheme = defaultTheme, children }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<ThemePalette>(initialTheme)

  const setTheme = useCallback((next: ThemePalette) => {
    setThemeState(next)
  }, [])

  const vars = themeToVars(theme)

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      <div style={vars as React.CSSProperties}>
        {children}
      </div>
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider')
  return ctx
}
