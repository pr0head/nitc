// Where the Android app lives, and whether we already run inside it.
const RELEASES = 'https://github.com/pr0head/nitc/releases';
export const APK_URL = `${RELEASES}/latest`;
// one release's notes (and its APK)
export const releaseUrl = (v) => `${RELEASES}/tag/v${v}`;
// the Android shell appends this to its user agent
const shell = navigator.userAgent.match(/NITC-Android\/(\S+)/);
export const inAndroidApp = !!shell;
// the shell's own version: it changes only when the APK is rebuilt
export const androidAppVersion = shell ? shell[1] : '';
// a browser on an Android phone: the app would serve it better
export const androidBrowser = !inAndroidApp && /Android/i.test(navigator.userAgent);
