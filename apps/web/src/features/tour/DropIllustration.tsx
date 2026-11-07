/**
 * A file going into a window: the whole of what dragging a file onto the page does, drawn with
 * boxes and nothing else (no image, no font). It loops slowly and holds still under
 * prefers-reduced-motion with the file already inside. Decorative: the text beside it says it.
 */
export function DropIllustration() {
  return (
    <div className="tour-drop" aria-hidden="true" data-testid="tour-illustration">
      <div className="tour-drop-window">
        <div className="tour-drop-bar">
          <span />
          <span />
          <span />
        </div>
        <div className="tour-drop-tabs">
          <span className="tour-drop-tab" />
          <span className="tour-drop-tab tour-drop-tab-new" />
        </div>
        <div className="tour-drop-code">
          <span />
          <span />
          <span />
        </div>
      </div>
      <div className="tour-drop-file">
        <span />
        <span />
      </div>
    </div>
  );
}
