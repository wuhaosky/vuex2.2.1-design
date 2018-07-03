export default function (Vue) {
    const version = Number(Vue.version.split('.')[0])

    if (version >= 2) {
        const usesInit = Vue.config._lifecycleHooks.indexOf('init') > -1
        Vue.mixin(usesInit ? {
            init: vuexInit
        } : {
            beforeCreate: vuexInit
        }) // vue组件的beforeCreate钩子执行时，会执行vuexInit方法
    } else {
        // override init and inject vuex init procedure
        // for 1.x backwards compatibility.
        const _init = Vue.prototype._init
        Vue.prototype._init = function (options = {}) {
            options.init = options.init ?
                [vuexInit].concat(options.init) :
                vuexInit
            _init.call(this, options)
        }
    }

    /**
     * Vuex init hook, injected into each instances init hooks list.
     * 为每一个vue实例注入store
     */

    function vuexInit() {
        const options = this.$options
        // store injection
        if (options.store) {
            this.$store = options.store
        } else if (options.parent && options.parent.$store) {
            this.$store = options.parent.$store
        }
    }
}