// Pet placeholder — the desktop-pet feature (sprite-sheet playback via the
// hatch-pet contract) is the next phase. This page just explains what's coming.
export default function PetPlaceholder() {
  return (
    <div className="settings-page">
      <div className="editor-header">
        <h2>桌宠</h2>
      </div>
      <div className="pet-placeholder">
        <div className="pet-emoji">🐾</div>
        <h3>桌宠功能开发中</h3>
        <p className="muted">
          下一阶段将支持：加载 Codex hatch-pet 生成的 sprite sheet
          （1536×1872，8列×9行），按 CLI 事件切换动画状态（空闲/工作中/等待/完成/出错）。
        </p>
        <p className="muted">素材生成：在任意 CLI 里调用 hatch-pet skill 即可。</p>
      </div>
    </div>
  );
}
