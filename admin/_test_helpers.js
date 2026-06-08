
function esc(str) { return String(str || '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }




const SUPP_IMAGE_EXT = /\.(jpe?g|png|gif|webp|svg|tiff?|bmp)$/i;
const SUPP_VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogv)$/i;
const SUPP_AUDIO_EXT = /\.(mp3|wav|ogg|m4a)$/i;
const SUPP_PDF_EXT   = /\.pdf$/i;
module.exports = { detectSuppKind, suppKindLabel, buildSupplementaryInsertHtml };
