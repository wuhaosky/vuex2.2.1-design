import applyMixin from './mixin'
import devtoolPlugin from './plugins/devtool'
import ModuleCollection from './module/module-collection'
import {
    forEachValue,
    isObject,
    isPromise,
    assert
} from './util'

let Vue // bind on install

export class Store {
    constructor(options = {}) {
        // 校验是否已经Vue.use(Vuex)
        assert(Vue, `must call Vue.use(Vuex) before creating a store instance.`)
        // 校验是否已经引用promise polyfill
        assert(
            typeof Promise !== 'undefined',
            `vuex requires a Promise polyfill in this browser.`
        )

        const {
            state = {}, plugins = [], strict = false
        } = options

        // store internal state
        this._committing = false // 正在修改state的标志位
        this._actions = Object.create(null)
        this._mutations = Object.create(null)
        this._wrappedGetters = Object.create(null)
        this._modules = new ModuleCollection(options)
        this._modulesNamespaceMap = Object.create(null) // 如Module有命令空间，则记录命令空间和Module的对应关系
        this._subscribers = [] // 订阅mutation
        this._watcherVM = new Vue() // 一个 Vue 对象的实例，主要是利用 Vue 实例方法 $watch 来观测变化的

        // bind commit and dispatch to self
        const store = this
        const {
            dispatch,
            commit
        } = this
        this.dispatch = function boundDispatch(type, payload) {
            return dispatch.call(store, type, payload)
        }
        this.commit = function boundCommit(type, payload, options) {
            return commit.call(store, type, payload, options)
        }

        // strict mode
        this.strict = strict

        // init root module.
        // this also recursively registers all sub-modules
        // and collects all module getters inside this._wrappedGetters
        // and collects all module mutations inside this._mutations
        // and collects all module actions inside this._actions
        installModule(this, state, [], this._modules.root)

        // initialize the store vm, which is responsible for the reactivity
        // (also registers _wrappedGetters as computed properties)
        resetStoreVM(this, state)

        // apply plugins
        plugins.concat(devtoolPlugin).forEach(plugin => plugin(this))
    }

    get state() {
        return this._vm._data.$$state
    }

    set state(v) {
        assert(false, `Use store.replaceState() to explicit replace store state.`)
    }

    /**
     * 提交 mutation
     * @param {*} _type
     * @param {*} _payload
     * @param {*} _options
     */
    commit(_type, _payload, _options) {
        // check object-style commit
        const {
            type,
            payload,
            options
        } = unifyObjectStyle(
            _type,
            _payload,
            _options
        )

        const mutation = {
            type,
            payload
        }
        const entry = this._mutations[type]
        if (!entry) {
            console.error(`[vuex] unknown mutation type: ${type}`)
            return
        }
        this._withCommit(() => {
            entry.forEach(function commitIterator(handler) {
                handler(payload)
            })
        })
        this._subscribers.forEach(sub => sub(mutation, this.state))

        if (options && options.silent) {
            console.warn(
                `[vuex] mutation type: ${type}. Silent option has been removed. ` +
                'Use the filter functionality in the vue-devtools'
            )
        }
    }

    /**
     * 分发action
     * @param {*} _type
     * @param {*} _payload
     */
    dispatch(_type, _payload) {
        // check object-style dispatch
        const {
            type,
            payload
        } = unifyObjectStyle(_type, _payload)

        const entry = this._actions[type]
        if (!entry) {
            console.error(`[vuex] unknown action type: ${type}`)
            return
        }
        return entry.length > 1 ?
            Promise.all(entry.map(handler => handler(payload))) :
            entry[0](payload)
    }

    /**
     * 订阅mutation 场景：常用于vuex的插件
     * @param {*} fn 回调函数，vuex会把这个回调函数保存到 this._subscribers 上
     * @return 一个函数，调用这个函数会取消对mutation的订阅
     */
    subscribe(fn) {
        const subs = this._subscribers
        if (subs.indexOf(fn) < 0) {
            subs.push(fn)
        }
        return () => {
            const i = subs.indexOf(fn)
            if (i > -1) {
                subs.splice(i, 1) // 将fn从this._subscribers中移除
            }
        }
    }

    /**
     * 响应式地监测一个 getter 方法的返回值，当值改变时调用回调函数cb。
     * @param {*} getter Getter 接收 store 的 state 作为第一个参数，store 的 getter 作为第二个参数。
     * @param {*} cb 回调函数
     * @param {*} options 可选的参数表示 Vue 的 vm.$watch 方法的参数。
     * @return 返回一个函数，要停止监测，直接调用返回的处理函数。
     */
    watch(getter, cb, options) {
        assert(typeof getter === 'function', `store.watch only accepts a function.`)
        return this._watcherVM.$watch(
            () => getter(this.state, this.getters),
            cb,
            options
        )
    }

    /**
     * replaceState的作用是替换整个 rootState 场景：调试
     * @param {*} state
     */
    replaceState(state) {
        this._withCommit(() => {
            this._vm._data.$$state = state
        })
    }

    /**
     * 动态注册Module
     * @param {*} path
     * @param {*} rawModule
     */
    registerModule(path, rawModule) {
        if (typeof path === 'string') path = [path]
        assert(Array.isArray(path), `module path must be a string or an Array.`)
        this._modules.register(path, rawModule)
        installModule(this, this.state, path, this._modules.get(path))
        // reset store to update getters...
        resetStoreVM(this, this.state)
    }

    /**
     * 注销Module
     * @param {*} path
     */
    unregisterModule(path) {
        if (typeof path === 'string') path = [path]
        assert(Array.isArray(path), `module path must be a string or an Array.`)
        this._modules.unregister(path)
        this._withCommit(() => {
            const parentState = getNestedState(this.state, path.slice(0, -1))
            Vue.delete(parentState, path[path.length - 1])
        })
        resetStore(this)
    }
    /**
     * 热更新
     * @param {*} newOptions
     */
    hotUpdate(newOptions) {
        this._modules.update(newOptions)
        resetStore(this, true)
    }
    /**
     * Vuex 中所有对 state 的修改都要用 _withCommit函数包装，保证在同步修改 state 的过程中 this._committing 的值始终为true。
     * @param {*} fn 修改state的函数
     */
    _withCommit(fn) {
        const committing = this._committing
        this._committing = true
        fn()
        this._committing = committing
    }
}

/**
 * 重置 store 对象
 * 由于 hot 始终为 true，这里我们就不会重新对状态树做设置，我们的 state 保持不变。
 * 因为我们已经明确的删除了对应 path 下的 state 了，要做的事情只不过就是重新注册一遍 muations、actions 以及 getters。
 * @param {*} store
 * @param {*} hot
 */
function resetStore(store, hot) {
    store._actions = Object.create(null)
    store._mutations = Object.create(null)
    store._wrappedGetters = Object.create(null)
    store._modulesNamespaceMap = Object.create(null)
    const state = store.state
    // init all modules
    installModule(store, state, [], store._modules.root, true)
    // reset vm
    resetStoreVM(store, state, hot)
}

/**
 * 初始化 store._vm，观测 state 和 getters 的变化，并将getters设为store._vm的计算属性
 * @param {*} store
 * @param {*} state
 * @param {*} hot
 */
function resetStoreVM(store, state, hot) {
    const oldVm = store._vm

    // bind store public getters
    store.getters = {}
    const wrappedGetters = store._wrappedGetters
    const computed = {}
    forEachValue(wrappedGetters, (fn, key) => {
        // use computed to leverage its lazy-caching mechanism
        computed[key] = () => fn(store)
        Object.defineProperty(store.getters, key, {
            get: () => store._vm[key],
            enumerable: true // for local getters
        })
    })

    // use a Vue instance to store the state tree
    // suppress warnings just in case the user has added
    // some funky global mixins
    const silent = Vue.config.silent
    Vue.config.silent = true // 设置 silent 为 true 的目的是为了取消这个 _vm 的所有日志和警告。
    store._vm = new Vue({
        data: {
            $$state: state
        },
        computed
    })
    Vue.config.silent = silent

    // enable strict mode for new vm
    if (store.strict) {
        enableStrictMode(store)
    }

    if (oldVm) {
        if (hot) {
            // dispatch changes in all subscribed watchers
            // to force getter re-evaluation for hot reloading.
            store._withCommit(() => {
                oldVm._data.$$state = null // 由于这个函数每次都会创建新的 Vue 实例并赋值到 store._vm 上，那么旧的 _vm 对象的状态设置为 null，并调用 $destroy 方法销毁这个旧的 _vm 对象。
            })
        }
        Vue.nextTick(() => oldVm.$destroy())
    }
}

/**
 * 安装module
 * collects all module states set this.state
 * and collects all module getters inside this._wrappedGetters
 * and collects all module mutations inside this._mutations
 * and collects all module actions inside this._actions
 * @param {*} store
 * @param {*} rootState
 * @param {*} path
 * @param {*} module
 * @param {*} hot
 */
function installModule(store, rootState, path, module, hot) {
    const isRoot = !path.length
    const namespace = store._modules.getNamespace(path)

    // register in namespace map
    if (module.namespaced) {
        store._modulesNamespaceMap[namespace] = module
    }

    // set state
    if (!isRoot && !hot) {
        const parentState = getNestedState(rootState, path.slice(0, -1))
        const moduleName = path[path.length - 1]
        store._withCommit(() => {
            Vue.set(parentState, moduleName, module.state)
        })
    }

    // 根据module的命名空间和path得到local(module的上下文) 包括局部的state、getter、dispatch、commit
    const local = (module.context = makeLocalContext(store, namespace, path))

    module.forEachMutation((mutation, key) => {
        const namespacedType = namespace + key
        registerMutation(store, namespacedType, mutation, local)
    })

    module.forEachAction((action, key) => {
        const namespacedType = namespace + key
        registerAction(store, namespacedType, action, local)
    })

    module.forEachGetter((getter, key) => {
        const namespacedType = namespace + key
        registerGetter(store, namespacedType, getter, local)
    })

    module.forEachChild((child, key) => {
        installModule(store, rootState, path.concat(key), child, hot)
    })
}

/**
 * make localized dispatch, commit, getters and state
 * if there is no namespace, just use root ones
 */
function makeLocalContext(store, namespace, path) {
    const noNamespace = namespace === ''

    const local = {
        dispatch: noNamespace ?
            store.dispatch :
            (_type, _payload, _options) => {
                const args = unifyObjectStyle(_type, _payload, _options)
                const {
                    payload,
                    options
                } = args
                let {
                    type
                } = args

                if (!options || !options.root) {
                    type = namespace + type
                    if (!store._actions[type]) {
                        console.error(
                            `[vuex] unknown local action type: ${
                  args.type
                }, global type: ${type}`
                        )
                        return
                    }
                }

                return store.dispatch(type, payload)
            },

        commit: noNamespace ?
            store.commit :
            (_type, _payload, _options) => {
                const args = unifyObjectStyle(_type, _payload, _options)
                const {
                    payload,
                    options
                } = args
                let {
                    type
                } = args

                if (!options || !options.root) {
                    type = namespace + type
                    if (!store._mutations[type]) {
                        console.error(
                            `[vuex] unknown local mutation type: ${
                  args.type
                }, global type: ${type}`
                        )
                        return
                    }
                }

                store.commit(type, payload, options)
            }
    }

    // getters and state object must be gotten lazily
    // because they will be changed by vm update
    Object.defineProperties(local, {
        getters: {
            get: noNamespace ?
                () => store.getters :
                () => makeLocalGetters(store, namespace)
        },
        state: {
            get: () => getNestedState(store.state, path)
        }
    })

    return local
}

function makeLocalGetters(store, namespace) {
    const gettersProxy = {}

    const splitPos = namespace.length
    Object.keys(store.getters).forEach(type => {
        // skip if the target getter is not match this namespace
        if (type.slice(0, splitPos) !== namespace) return

        // extract local getter type
        const localType = type.slice(splitPos)

        // Add a port to the getters proxy.
        // Define as getter property because
        // we do not want to evaluate the getters in this time.
        Object.defineProperty(gettersProxy, localType, {
            get: () => store.getters[type],
            enumerable: true
        })
    })

    return gettersProxy
}

/**
 * 把module的mutations登记到this._mutations
 * @param {*} store
 * @param {*} type
 * @param {*} handler
 * @param {*} local
 */
function registerMutation(store, type, handler, local) {
    const entry = store._mutations[type] || (store._mutations[type] = [])
    entry.push(function wrappedMutationHandler(payload) {
        handler(local.state, payload)
    })
}

/**
 * 把module的actions登记到this._actions
 * @param {*} store
 * @param {*} type
 * @param {*} handler
 * @param {*} local
 */
function registerAction(store, type, handler, local) {
    const entry = store._actions[type] || (store._actions[type] = [])
    entry.push(function wrappedActionHandler(payload, cb) {
        let res = handler({
                dispatch: local.dispatch,
                commit: local.commit,
                getters: local.getters,
                state: local.state,
                rootGetters: store.getters,
                rootState: store.state
            },
            payload,
            cb
        )
        if (!isPromise(res)) {
            res = Promise.resolve(res)
        }
        if (store._devtoolHook) {
            return res.catch(err => {
                store._devtoolHook.emit('vuex:error', err)
                throw err
            })
        } else {
            return res
        }
    })
}

/**
 * 把module的getters登记到this._wrappedGetters
 * @param {*} store
 * @param {*} type
 * @param {*} rawGetter
 * @param {*} local
 */
function registerGetter(store, type, rawGetter, local) {
    if (store._wrappedGetters[type]) {
        console.error(`[vuex] duplicate getter key: ${type}`)
        return
    }
    store._wrappedGetters[type] = function wrappedGetter(store) {
        return rawGetter(
            local.state, // local state
            local.getters, // local getters
            store.state, // root state
            store.getters // root getters
        )
    }
}

/**
 * 开启严格模式
 * 严格模式的功能是：监听store._vm._data.$$state，当改变时，判断此时store._committing是不是true，若不是则抛出提示“修改state必须在mutation的handler里”
 * @param {*} store
 */
function enableStrictMode(store) {
    store._vm.$watch(
        function () {
            return this._data.$$state
        },
        () => {
            assert(
                store._committing,
                `Do not mutate vuex store state outside mutation handlers.`
            )
        }, {
            deep: true,
            sync: true
        }
    )
}

/**
 * 获得path对应的Module的state
 * @param {*} state
 * @param {*} path
 */
function getNestedState(state, path) {
    return path.length ? path.reduce((state, key) => state[key], state) : state
}

function unifyObjectStyle(type, payload, options) {
    if (isObject(type) && type.type) {
        options = payload
        payload = type
        type = type.type
    }

    assert(
        typeof type === 'string',
        `Expects string as the type, but found ${typeof type}.`
    )

    return {
        type,
        payload,
        options
    }
}

/**
 * 安装vue插件
 * @param {*} _Vue Vue的构造函数
 */
export function install(_Vue) {
    if (Vue) {
        console.error(
            '[vuex] already installed. Vue.use(Vuex) should be called only once.'
        )
        return
    }
    Vue = _Vue
    applyMixin(Vue) // 把vuex.store(options)生成的store赋值给所有的vue实例，也就是在每个vue组件里，都可以使用this.$store访问store。
}

// auto install in dist mode
// 如果是standalone引入的vue会自动执行install方法
// 如果是通过npm引入的vue，需要手动执行install方法
if (typeof window !== 'undefined' && window.Vue) {
    install(window.Vue)
}