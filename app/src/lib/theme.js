import { DarkTheme, DefaultTheme } from "@react-navigation/native";

/**
 * JavaScript mirror of the CSS variables in global.css.
 *
 * ⚠️ These values are duplicated by necessity: CSS custom properties live in
 * the NativeWind style engine and cannot be read from JS at runtime, but
 * React Navigation needs plain colour strings for its container theme, and
 * some APIs (lucide `color`, svg fills, StatusBar, react-native-tab-view)
 * take colours as props rather than classes.
 *
 * If you change a colour in global.css, change it here too. Anything you can
 * express as a `className` should use the class and never touch this file.
 */
export const THEME = {
  light: {
    background: "hsl(210 40% 98%)",
    foreground: "hsl(220.5 58.9% 14.3%)",
    card: "hsl(0 0% 100%)",
    cardForeground: "hsl(220.5 58.9% 14.3%)",
    primary: "hsl(215.3 73.9% 22.5%)",
    primaryForeground: "hsl(0 0% 100%)",
    secondary: "hsl(210 40% 96.1%)",
    secondaryForeground: "hsl(220.5 58.9% 14.3%)",
    muted: "hsl(210 40% 96.1%)",
    mutedForeground: "hsl(218.9 16.9% 42.9%)",
    accent: "hsl(76.5 59% 54.1%)",
    accentForeground: "hsl(78.9 71.2% 24.5%)",
    destructive: "hsl(0 72.2% 50.6%)",
    destructiveForeground: "hsl(0 0% 98%)",
    border: "hsl(216.7 33.3% 89.4%)",
    input: "hsl(216.7 33.3% 89.4%)",
    ring: "hsl(76.5 59% 54.1%)",
    text2: "hsl(220.5 41% 20.6%)",
    lineSoft: "hsl(213.3 36% 95.1%)",
    link: "hsl(218.2 56.3% 42.2%)",
    brand: "hsl(215.3 73.9% 22.5%)",
    brandRaised: "hsl(215.3 54.8% 28.6%)",
    brandCourt: "hsl(216.7 64.9% 25.7%)",
    brandBall: "hsl(76.5 59% 54.1%)",
  },
  dark: {
    background: "hsl(221.1 65.5% 11.4%)",
    foreground: "hsl(216.9 61.9% 95.9%)",
    card: "hsl(218.8 63% 15.9%)",
    cardForeground: "hsl(216.9 61.9% 95.9%)",
    primary: "hsl(0 0% 100%)",
    primaryForeground: "hsl(215.3 73.9% 22.5%)",
    secondary: "hsl(219.3 55.6% 19.4%)",
    secondaryForeground: "hsl(216.9 61.9% 95.9%)",
    muted: "hsl(219.3 55.6% 19.4%)",
    mutedForeground: "hsl(218.5 28.9% 73.5%)",
    accent: "hsl(76.5 59% 54.1%)",
    accentForeground: "hsl(76.5 59% 54.1%)",
    destructive: "hsl(0 90.6% 70.8%)",
    destructiveForeground: "hsl(215.3 73.9% 22.5%)",
    border: "hsl(218.8 50% 26.7%)",
    input: "hsl(218.8 50% 26.7%)",
    ring: "hsl(76.5 59% 54.1%)",
    text2: "hsl(218.7 34.8% 82.5%)",
    lineSoft: "hsl(219.3 55.6% 19.4%)",
    link: "hsl(217.8 65.9% 73.5%)",
    brand: "hsl(215.3 73.9% 22.5%)",
    brandRaised: "hsl(215.3 54.8% 28.6%)",
    brandCourt: "hsl(216.7 64.9% 25.7%)",
    brandBall: "hsl(76.5 59% 54.1%)",
  },
};

/**
 * Themes for NavigationContainer. Spread from React Navigation's defaults so
 * the `fonts` key it requires in v7 is present.
 */
export const NAV_THEME = {
  light: {
    ...DefaultTheme,
    colors: {
      ...DefaultTheme.colors,
      background: THEME.light.background,
      border: THEME.light.border,
      card: THEME.light.card,
      notification: THEME.light.destructive,
      primary: THEME.light.primary,
      text: THEME.light.foreground,
    },
  },
  dark: {
    ...DarkTheme,
    colors: {
      ...DarkTheme.colors,
      background: THEME.dark.background,
      border: THEME.dark.border,
      card: THEME.dark.card,
      notification: THEME.dark.destructive,
      primary: THEME.dark.primary,
      text: THEME.dark.foreground,
    },
  },
};
