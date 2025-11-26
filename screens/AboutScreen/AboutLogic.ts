export const openAboutScreen = (
  navigation: { navigate: (route: string) => void } | null,
  fallback?: () => void,
) => {
  try {
    if (navigation && typeof navigation.navigate === 'function') {
      navigation.navigate('AboutScreen');
      return;
    }
  } catch (_e) {}
  if (fallback) fallback();
};

