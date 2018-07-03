import Module from './module'
import { forEachValue } from '../util'

export default class ModuleCollection {
  constructor (rawRootModule) {
    // register root module (Vuex.Store options)
    this.root = new Module(rawRootModule, false) // 根module

    // register all nested modules 
    if (rawRootModule.modules) {
      forEachValue(rawRootModule.modules, (rawModule, key) => {
        this.register([key], rawModule, false)
      })
    }
  }
  // 根据path，得到对应的Module对象   
  // path是数组，如果数组是空数组，返回this.root；否则返回其对应的Module
  get (path) {
    return path.reduce((module, key) => {
      return module.getChild(key)
    }, this.root)
  }
  // 根据path，得到对应的Module的命名空间，以‘/’拼接
  getNamespace (path) {
    let module = this.root
    return path.reduce((namespace, key) => {
      module = module.getChild(key)
      return namespace + (module.namespaced ? key + '/' : '')
    }, '')
  }
  // 更新rootModule
  update (rawRootModule) {
    update(this.root, rawRootModule)
  }
  // 注册Module
  register (path, rawModule, runtime = true) {
    const parent = this.get(path.slice(0, -1)) // path取0到倒数第一个元素（不包含倒数第一个），也就是最后一个的父Module的path
    const newModule = new Module(rawModule, runtime)
    parent.addChild(path[path.length - 1], newModule)

    // register nested modules 递归的注册子module
    if (rawModule.modules) {
      forEachValue(rawModule.modules, (rawChildModule, key) => {
        this.register(path.concat(key), rawChildModule, runtime)
      })
    }
  }
  // 注销Module
  unregister (path) {
    const parent = this.get(path.slice(0, -1)) // 根据path拿到当前path的父Module
    const key = path[path.length - 1] // 根据path拿到当前path的表示的Module的key
    if (!parent.getChild(key).runtime) return // 不是动态注册的数据，则不能注销Module

    parent.removeChild(key) // 父Module移除此子Module
  }
}
// 根据newModule递归的更新targetModule
function update (targetModule, newModule) {
  // update target module
  targetModule.update(newModule)

  // update nested modules
  if (newModule.modules) {
    for (const key in newModule.modules) {
      if (!targetModule.getChild(key)) {
        console.warn(
          `[vuex] trying to add a new module '${key}' on hot reloading, ` +
          'manual reload is needed'
        )
        return
      }
      update(targetModule.getChild(key), newModule.modules[key])
    }
  }
}


// path的概念
// 表示Module的层级关系
// path是一个数组

/** 

    [""] 表示根Module 
    {
        modules: {},
        state: {},
        actions: {},
        mutations: {},
        getters: {}
    }

    ["", "moduleA"] 表示 
    {
        modules: {
            moduleA: {
                state: {},
                actions: {},
                mutations: {},
                getters: {}
            }
        },
        state: {},
        actions: {},
        mutations: {},
        getters: {}
    }

    ["", "moduleB"] 表示 
    {
        modules: {
            moduleB: {
                state: {},
                actions: {},
                mutations: {},
                getters: {}
            }
        },
        state: {},
        actions: {},
        mutations: {},
        getters: {}
    }

    ["", "moduleA", "moduleAA"] 表示 
    {
        modules: {
            moduleA: {
                state: {},
                actions: {},
                mutations: {},
                getters: {},
                modules: {
                    moduleAA: {
                        state: {},
                        actions: {},
                        mutations: {},
                        getters: {}
                    }
                }
            }
        },
        state: {},
        actions: {},
        mutations: {},
        getters: {}
    }
*/

// runtime 表示动态注册
// runtime为false，表示初始化store时的静态数据；
// runtime为true，表示动态使用register方法注册的数据。
