const patterns = {
  deal: [
    [720, 0, 0.045],
    [540, 0.08, 0.045],
  ],
  chip: [
    [1100, 0, 0.035],
    [790, 0.045, 0.04],
  ],
  turn: [
    [620, 0, 0.1],
    [830, 0.12, 0.15],
  ],
  warning: [[440, 0, 0.13]],
  win: [
    [523, 0, 0.1],
    [659, 0.11, 0.1],
    [784, 0.22, 0.18],
  ],
};
function playSound(page, kind) {
  if (
    page.hidden ||
    !page.data.experience?.sound ||
    !page.data.experience.volume
  )
    return;
  try {
    if (!wx.createInnerAudioContext) return;
    if (!page.audio) {
      page.audio = wx.createInnerAudioContext();
      page.audio.onError?.(() => {});
    }
    page.audio.stop();
    page.audio.volume = page.data.experience.volume;
    page.audio.obeyMuteSwitch = true;
    page.audio.src = "/assets/sounds/" + kind + ".wav";
    page.audio.play();
  } catch {}
}
module.exports = { playSound, patterns };
