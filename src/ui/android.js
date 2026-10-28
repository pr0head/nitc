// Where the Android app lives, and whether we already run inside it.
export const APK_URL = 'https://github.com/pr0head/nitc/releases/latest';
// the Android shell appends this to its user agent
const shell = navigator.userAgent.match(/NITC-Android\/(\S+)/);
export const inAndroidApp = !!shell;
// the shell's own version: it changes only when the APK is rebuilt
export const androidAppVersion = shell ? shell[1] : '';
// a browser on an Android phone: the app would serve it better
export const androidBrowser = !inAndroidApp && /Android/i.test(navigator.userAgent);
