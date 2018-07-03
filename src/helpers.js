/**
 * mapState 的作用是把store的 state 和 getters 映射到当前组件的 computed 计算属性中
 */
export const mapState = normalizeNamespace((namespace, states) => {
    const res = {}
    normalizeMap(states).forEach(({
        key,
        val
    }) => {
        res[key] = function mappedState() {
            let state = this.$store.state
            let getters = this.$store.getters
            if (namespace) {
                const module = getModuleByNamespace(this.$store, 'mapState', namespace)
                if (!module) {
                    return
                }
                state = module.context.state
                getters = module.context.getters
            }
            return typeof val === 'function' ?
                val.call(this, state, getters) :
                state[val]
        }
        // mark vuex getter for devtools
        res[key].vuex = true
    })
    return res // 真正的返回值，是一个对象，如果val是函数则传入的参数是state和getter，否则是state[val]
})

/**
 * mapMutations 的作用是把store的 mutations 映射到当前组件的 methods 中
 */
export const mapMutations = normalizeNamespace((namespace, mutations) => {
    const res = {}
    normalizeMap(mutations).forEach(({
        key,
        val
    }) => {
        val = namespace + val
        res[key] = function mappedMutation(...args) {
            if (namespace && !getModuleByNamespace(this.$store, 'mapMutations', namespace)) {
                return
            }
            return this.$store.commit.apply(this.$store, [val].concat(args))
        }
    })
    return res
})

/**
 * mapGetters 的作用是把store的 getters 映射到当前组件的 computed 计算属性中
 */
export const mapGetters = normalizeNamespace((namespace, getters) => {
    const res = {}
    normalizeMap(getters).forEach(({
        key,
        val
    }) => {
        val = namespace + val
        res[key] = function mappedGetter() {
            if (namespace && !getModuleByNamespace(this.$store, 'mapGetters', namespace)) {
                return
            }
            if (!(val in this.$store.getters)) {
                console.error(`[vuex] unknown getter: ${val}`)
                return
            }
            return this.$store.getters[val]
        }
        // mark vuex getter for devtools
        res[key].vuex = true
    })
    return res
})

/**
 * mapActions 的作用是把store的 actions 映射到当前组件的 methods 中
 */
export const mapActions = normalizeNamespace((namespace, actions) => {
    const res = {}
    normalizeMap(actions).forEach(({
        key,
        val
    }) => {
        val = namespace + val
        res[key] = function mappedAction(...args) {
            if (namespace && !getModuleByNamespace(this.$store, 'mapActions', namespace)) {
                return
            }
            return this.$store.dispatch.apply(this.$store, [val].concat(args))
        }
    })
    return res
})

/**
 * 把数组或对象变形成{
 *  key: key,
 *  val: val
 * },方便后续处理
 * @param {*} map 
 */
function normalizeMap(map) {
    return Array.isArray(map) ?
        map.map(key => ({
            key,
            val: key
        })) :
        Object.keys(map).map(key => ({
            key,
            val: map[key]
        }))
}

function normalizeNamespace(fn) {
    return (namespace, map) => {
        if (typeof namespace !== 'string') {
            map = namespace
            namespace = ''
        } else if (namespace.charAt(namespace.length - 1) !== '/') {
            namespace += '/'
        }
        return fn(namespace, map)
    }
}

function getModuleByNamespace(store, helper, namespace) {
    const module = store._modulesNamespaceMap[namespace]
    if (!module) {
        console.error(`[vuex] module namespace not found in ${helper}(): ${namespace}`)
    }
    return module
}