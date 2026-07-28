// ReactUtils.js — Utilitários para acessar internals do React
// Utilitários para acessar internals do React

export default class ReactUtils {
    constructor () {}

    ReactKey = (elem, prefix) => {
        if (elem == null || elem == undefined) {
            return;
        }
        let key = Object.keys(elem).find(key => key.startsWith(prefix));
        return elem[key];
    }

    ReactInternal = (elem) => {
        return this.ReactKey(elem, "__reactInternalInstance$");
    }

    ReactEvents = (elem) => {
        return this.ReactKey(elem, "__reactEventHandlers$");
    }

    ReactFiber = (elem) => {
        return this.ReactKey(elem, "__reactFiber$");
    }
    
    ReactProps = (elem) => {
        return this.ReactKey(elem, "__reactProps$");
    }
}
