// Pet settings — pick which pet the desktop overlay shows.
// Lists pets from the project's pets/ dir (via pets:list IPC) and saves the
// choice to config.activePet; the main process hot-swaps the pet on save.
import { useEffect, useState } from 'react';
import type { RuntimeConfig } from '@shared/config';
import { ucp } from '../ipc';

export default function PetSettings({
  config,
  onSave,
}: {
  config: RuntimeConfig;
  onSave: (cfg: RuntimeConfig) => void;
}) {
  const [pets, setPets] = useState<Array<{ id: string; displayName: string }>>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    ucp
      .listPets()
      .then(setPets)
      .catch((e) => setErr(String(e)));
  }, []);

  function selectPet(id: string): void {
    onSave({ ...config, activePet: id });
  }

  return (
    <div className="settings-page">
      <div className="editor-header">
        <h2>桌宠</h2>
        <p className="muted">选择桌宠形象。素材来自 pets/ 目录（用 hatch-pet 生成后复制进来）。</p>
      </div>

      {err && <p className="muted">读取 pet 列表失败：{err}</p>}

      {pets.length === 0 && !err && <p className="muted">（pets/ 目录下没有可用的 pet）</p>}

      <div className="pet-list">
        {pets.map((p) => {
          const active = (config.activePet || pets[0]?.id) === p.id;
          return (
            <button
              key={p.id}
              className={`pet-card ${active ? 'pet-card-active' : ''}`}
              onClick={() => selectPet(p.id)}
            >
              <span className="pet-card-name">{p.displayName}</span>
              {active && <span className="pet-card-check">✓ 当前</span>}
            </button>
          );
        })}
      </div>

      <p className="muted" style={{ marginTop: 16 }}>
        新增 pet：用任意 CLI 调用 hatch-pet skill 生成，把产出的
        <code> pet.json + spritesheet.webp </code>
        复制到 <code>UnionCodePet/pets/&lt;pet名&gt;/</code>，重启后在此选择。
      </p>
    </div>
  );
}
