// memory/index.ts —— 记忆索引管理的公共入口
// 核心索引读写与渲染逻辑实现在 store.ts 中，本文件作为简洁的公共接口层。

export {
  loadIndexes,
  readIndex,
  writeIndex,
  renderIndexText,
} from "./store.js";
