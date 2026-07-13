// Registers every style chunk in cascade order. Phase 1 of the DS migration
// moved the old monolithic strings (styles.ts CSS, VIEWS_CSS, PICKER_CSS,
// AI_CSS) verbatim into these co-located files; later phases split them
// further per component. Import order here IS the cascade order within a
// layer -- append new feature chunks at the end unless a chunk must override.
import { registerCss } from './registry'
import tokens from './tokens.css?inline'
import base from './base.css?inline'
import views from '../../panels/views/views.css?inline'
import editor from '../../features/editor/editor.css?inline'
import home from '../../features/home/home.css?inline'
import account from '../../features/account/account.css?inline'
import worlds from '../../features/worlds/worlds.css?inline'
import publish from '../../features/publish/publish.css?inline'
import devSignin from '../../features/account/dev-signin.css?inline'
import ai from '../../features/ai/ai.css?inline'

registerCss('ds/tokens', 'tokens', tokens)
registerCss('ds/base', 'base', base)
registerCss('views', 'primitives', views)
registerCss('feature/editor', 'features', editor)
registerCss('feature/home', 'features', home)
registerCss('feature/account', 'features', account)
registerCss('feature/worlds', 'features', worlds)
registerCss('feature/publish', 'features', publish)
registerCss('feature/account-dev-signin', 'features', devSignin)
registerCss('feature/ai', 'features', ai)

export { collectCss, registerCss } from './registry'
