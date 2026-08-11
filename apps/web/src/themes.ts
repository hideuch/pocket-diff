export const APP_THEMES = [
  { id: "light", label: "Light", description: "明るくニュートラル", codeTheme: "pierre-light", themeType: "light" },
  { id: "dark", label: "Dark", description: "目に優しい高コントラスト", codeTheme: "pierre-dark", themeType: "dark" },
  {
    id: "github",
    label: "GitHub Light",
    description: "使い慣れた明るいコードレビュー配色",
    codeTheme: "github-light",
    themeType: "light",
  },
  {
    id: "github-dark",
    label: "GitHub Dark",
    description: "GitHubのダークコードレビュー配色",
    codeTheme: "github-dark",
    themeType: "dark",
  },
  {
    id: "tokyo-night",
    label: "Tokyo Night",
    description: "青紫を基調とした夜間表示",
    codeTheme: "tokyo-night",
    themeType: "dark",
  },
  {
    id: "claude",
    label: "Claude Light",
    description: "クリームとコーラルの温かな配色",
    codeTheme: "pierre-light",
    themeType: "light",
  },
  {
    id: "claude-dark",
    label: "Claude Dark",
    description: "焦茶とコーラルの落ち着いた配色",
    codeTheme: "pierre-dark",
    themeType: "dark",
  },
] as const;

export type AppTheme = (typeof APP_THEMES)[number]["id"];
export type AppThemeDefinition = (typeof APP_THEMES)[number];

export function isAppTheme(value: string | null): value is AppTheme {
  return APP_THEMES.some((theme) => theme.id === value);
}

export function getAppTheme(themeId: AppTheme) {
  return APP_THEMES.find((theme) => theme.id === themeId) || APP_THEMES[0];
}
