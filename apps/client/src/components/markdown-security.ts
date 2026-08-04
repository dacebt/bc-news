// Raw HTML never renders: react-markdown skips HTML nodes by default, and the
// disallowed list keeps active-content elements out even if a plugin changes that.
// img is disallowed too: a remote src is a fetch beacon any reader triggers on
// render, and edition prose has no legitimate use for embedded images.
export const DISALLOWED_ELEMENTS = ["script", "iframe", "object", "embed", "img"];
