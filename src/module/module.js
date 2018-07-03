import { forEachValue } from '../util'

/**
 * module模型
 */
export default class Module {
  constructor (rawModule, runtime) {
    this.runtime = runtime // 是否是动态注册的module
    this._children = Object.create(null) // 嵌套子module，存放的是Module类型
    this._rawModule = rawModule // module原始数据
  }
  // get state  
  get state () {
    return this._rawModule.state || {}
  }
  // get 是否开启了命名空间  
  get namespaced () {
    return !!this._rawModule.namespaced
  }
  // 增加子module
  addChild (key, module) {
    this._children[key] = module
  }
  // 删除子module  
  removeChild (key) {
    delete this._children[key]
  }
  // get 子module  
  getChild (key) {
    return this._children[key]
  }
  // 更新module的 namespaced、actions、mutations、getters
  update (rawModule) {
    this._rawModule.namespaced = rawModule.namespaced
    if (rawModule.actions) {
      this._rawModule.actions = rawModule.actions
    }
    if (rawModule.mutations) {
      this._rawModule.mutations = rawModule.mutations
    }
    if (rawModule.getters) {
      this._rawModule.getters = rawModule.getters
    }
  }
  // 遍历子module，回调fn
  forEachChild (fn) {
    forEachValue(this._children, fn)
  }
  // 遍历子getter，回调fn
  forEachGetter (fn) {
    if (this._rawModule.getters) {
      forEachValue(this._rawModule.getters, fn)
    }
  }
  // 遍历子action，回调fn
  forEachAction (fn) {
    if (this._rawModule.actions) {
      forEachValue(this._rawModule.actions, fn)
    }
  }
  // 遍历子mutation，回调fn
  forEachMutation (fn) {
    if (this._rawModule.mutations) {
      forEachValue(this._rawModule.mutations, fn)
    }
  }
}
