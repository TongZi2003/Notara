import { initBrowserMock, dispatchMockMessages } from '../upstream/webview-ui/src/browserMock';
import { setCharacterTemplates } from '../upstream/webview-ui/src/office/sprites/spriteData';
import { setFloorSprites } from '../upstream/webview-ui/src/office/floorTiles';
import { setWallSprites } from '../upstream/webview-ui/src/office/wallTiles';
import { setCarpetSprites } from '../upstream/webview-ui/src/office/sprites/carpetTiles';
import { buildDynamicCatalog, type LoadedAssetData } from '../upstream/webview-ui/src/office/layout/furnitureCatalog';
import type { ServerMessage } from '../upstream/core/src/messages';
import { loadCharacterSkins } from './character-skins';

let furniture: LoadedAssetData | null = null;
export function getClassroomAssets(): LoadedAssetData {
  if (!furniture) throw new Error('教室素材尚未加载');
  return furniture;
}

/** Keep upstream PNG decoding and its ordered asset contract. The temporary
 * listener receives only the decoder's synchronous messages, not agent state. */
export async function loadClassroomAssets(): Promise<void> {
  await initBrowserMock();
  const receive = (event: MessageEvent<ServerMessage>) => {
    const message = event.data;
    switch (message?.type) {
      case 'characterSpritesLoaded': setCharacterTemplates(message.characters); break;
      case 'floorTilesLoaded': setFloorSprites(message.sprites); break;
      case 'wallTilesLoaded': setWallSprites(message.sets); break;
      case 'carpetTilesLoaded': setCarpetSprites(message.sets); break;
      case 'furnitureAssetsLoaded': {
        furniture = { catalog: message.catalog, sprites: message.sprites };
        if (!buildDynamicCatalog(furniture)) throw new Error('教室家具加载失败');
        break;
      }
    }
  };
  window.addEventListener('message', receive);
  try { dispatchMockMessages(); } finally { window.removeEventListener('message', receive); }
  if (!furniture) throw new Error('教室素材未完整加载，请刷新后重试');
  // Keep the pinned engine/furniture intact; only replace its character templates.
  setCharacterTemplates(await loadCharacterSkins());
}
