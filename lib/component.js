const React = require('react');
const Axial = require('axial');
const _currentRenderingComponent = [];
const PROXY_KEY = Axial.PROXY_KEY;
const _transitions = {};
_transitions.end = (function () {
  let t;
  const el = document.createElement('fakeelement');
  const transitions = {
    'transition':'transitionend',
    'OTransition':'oTransitionEnd',
    'MozTransition':'transitionend',
    'WebkitTransition':'webkitTransitionEnd'
  };

  for (t in transitions) {
    if(el.style[t] !== undefined) {
      return transitions[t];
    }
  }
})();
let _transitionId = 0;

class AxialComponent extends React.Component {
  constructor (...args) {
    super(...args);

    this._bindings = [];
    this._transitionListeners = {};

    this.__render = this.render;
    this.render = this._render;
  }

  shouldComponentUpdate (nextProps, nextState) {
    const state = this.state;
    let isEqual = true;
    for (let path in state) {
      if (state.hasOwnProperty(path)) {
        const currentValue = state[path];
        const nextValue = nextState[path];
        let notEqual = currentValue !== nextValue;
        if (currentValue === nextValue && currentValue instanceof Axial.InstanceArray) {
          notEqual = true;
        } else if (currentValue instanceof Axial.Instance.constructor) {
          notEqual = !currentValue[PROXY_KEY].equals(nextValue);
        } else if (currentValue instanceof Axial.InstanceArray) {
          notEqual = !currentValue.equals(nextValue);
        }
        if (notEqual) {
          isEqual = false;
          Axial.log({
            method: 'component.bindings.changed',
            component: this,
            path: path
          });
          break;
        }
      }
    }
    if (isEqual) {
      Axial.log({
        method: 'component.bindings.changed.equal',
        component: this
      });
    } else {
      Axial.log({
        method: 'component.bindings.changed.difference',
        component: this
      });
    }
    // TODO: check prop diffs too?
    return !isEqual;
  }

  /**
   * actual render method, swapped in constructor
   * @returns {XML}
   * @private
   */
  _render () {
    Axial.log({
      method: 'component.render.start',
      component: this
    });

    // start capturing bindings accessed
    this.enterRender();

    // render output, rendering will create new bindings as instance properties are read (through temp global listener)
    let output = this.__render();

    if (AxialComponent.debug === true && output !== null && typeof AxialComponent.onDebugRender === 'function') {
      output = AxialComponent.onDebugRender(output, this);
    }

    // stop rendering and initialise/process new bindings
    this.exitRender();

    Axial.log({
      method: 'component.render.end',
      component: this
    });

    // return output
    return output;
  }

  /**
   * global Axial.bind handler
   * this tells the component something was accessed.
   * since JavaScript is single-threaded, we can assume this is the currently rendering component.
   * @param eventData
   */
  captureBindingDuringRender (eventData) {
    // only use GET
    if (eventData.method === 'get') {
      const instance = eventData.instance;
      const property = eventData.property;
      const key = property.key;
      // check if already have bindings, don't add two of same instance and key
      if (this._bindings.find(binding => binding.instance === instance && binding.key === key)) {
        return;
      }
      // get this component to re-render every time the instance property changes (to a new unique value)
      const binding = new Axial.Binding(instance, key, this.onInstanceChange.bind(this));
      this._bindings.push(binding);
    }
  }

  /**
   * An instance which this component is bound to has updated
   * @param eventData
   */
  onInstanceChange (eventData) {
    // only use SET
    if (eventData.method === 'set') {
      Axial.log({
        method: 'component.binding.changed',
        component: this,
        property: eventData.property,
        oldValue: eventData.oldValue,
        newValue: eventData.newValue,
        event: eventData
      });
      if (eventData.value === eventData.oldValue) {
        Axial.log({
          method: 'component.binding.equal',
          property: eventData.property,
          event: eventData
        });
        return;
      }
      Axial.log({
        method: 'component.binding.difference',
        property: eventData.property,
        event: eventData
      });
      const state = {};
      state[eventData.instance[PROXY_KEY].toString() + ':' + eventData.property.key] = eventData.value;
      this.setState(state);
    }
  }

  /**
   * Clear previous bindings each render, start listening globally to all GET accessors
   */
  enterRender () {
    // clear previous bindings
    const bindings = this._bindings;
    let l = bindings.length;
    for (let i = 0; i < l; i++) {
      bindings[i].dispose();
    }
    bindings.length = 0;

    // bind to global instance property change events
    Axial.bind(this.captureBindingDuringRender.bind(this));

    // become the currently rendering component
    _currentRenderingComponent.push(this);

    // clear previous transition listeners
    for (let id in this._transitionListeners) {
      if (this._transitionListeners.hasOwnProperty(id)) {
        const info = this._transitionListeners[id];
        document.body.removeEventListener(info.eventName, info.handler, true);
        delete this._transitionListeners[id];
      }
    }
  }

  /**
   * Stop listening globally for getters, process new bindings and set state
   */
  exitRender () {
    Axial.log({
      method: 'component.render.bindings',
      component: this
    });

    // create state from current bindings
    const state = {};
    const bindings = this._bindings;
    const l = bindings.length;
    for (let i = 0; i < l; i++) {
      let binding = bindings[i];
      binding.index = i;
      Axial.log({
        method: 'component.render.binding',
        component: this,
        binding: binding
      });
      state[binding.toString()] = binding.get();
      binding.bind();
    }

    // set state from read properties
    this.state = state;

    // stop being the currently rendered component
    _currentRenderingComponent.pop();

    // unbind to global instance property change events
    Axial.unbind(this.captureBindingDuringRender.bind(this));
  }

  /**
   * register a callback with a transition end
   * @param propertyName
   * @param value
   * @param fn
   */
  onTransitionEnd (fn) {
    const TRANSITION_EVENT = _transitions.end;
    const transitionKey = '' + _transitionId++;
    const handler = function (e) {
      const property = e.propertyName;
      const value = parseFloat(getComputedStyle(e.target)[property]);
      const targetId = e.target.getAttribute('data-transition-end');
      if (targetId === transitionKey) {
        fn({
          property: e.propertyName,
          value: value,
          originalEvent: e
        });
      }
    }.bind(this);
    document.body.addEventListener(TRANSITION_EVENT, handler, true);
    this._transitionListeners[transitionKey] = {
      eventName: TRANSITION_EVENT,
      handler: handler
    };
    return transitionKey;
  }

  static getParentWithAttr (target, attrName) {
    let ref = target;
    const body = document.body;
    while (ref !== body) {
      if (ref.getAttribute(attrName)) {
        return ref;
      }
      ref = ref.parentNode;
    }
    return null;
  }
}

AxialComponent.debug = false;
AxialComponent.onDebugRender = (output, component) => {
  // wrap in debugging component (optional)
  const r = Math.round(Math.random() * 255);
  const g = Math.round(Math.random() * 255);
  const b = Math.round(Math.random() * 255);
  return <div style={{backgroundColor:'rgb(' + [r,g,b].join(',') + ')',border:'3px dashed rgba(0,0,0,0.1)',margin:'5px',padding:'5px'}}><b style={{padding:'5px',borderRadius:'5px',border:'1px solid #fff',backgroundColor:'rgba(255,255,255,0.5)'}}>{component.constructor.name}</b>{output}</div>;
};

AxialComponent.addDefaultLogListeners = function () {
  Axial.addLogListener('component.bindings.changed', e => {
    console.log(`%c[${e.component.constructor.name}.${e.path}] bindings changed`, 'color:red');
  }).addLogListener('component.bindings.changed.equal', e => {
    console.log(`%c[${e.component.constructor.name}] bindings are equal, should not update`, 'color:green');
  }).addLogListener('component.bindings.changed.difference', e => {
    console.log(`%c[${e.component.constructor.name}] bindings are not equal, should update`, 'color:red');
  }).addLogListener('component.render.start', e => {
    console.group(`RENDER:[${e.component.constructor.name}]`);
  }).addLogListener('component.render.end', e => {
    console.groupEnd();
  }).addLogListener('component.binding.changed', e => {
    console.log(`%cCHANGE:[${e.property.path}] old: ${Axial.util.stringify(e.oldValue)} new: ${Axial.util.stringify(e.newValue)}`, 'color:blue');
  }).addLogListener('component.binding.equal', e => {
    console.log(`%cEQUAL:[${e.property.path}]`, 'color:green');
  }).addLogListener('component.binding.difference', e => {
    console.log(`%cDIFFERENCE:[${e.property.path}]`, 'color:red');
  }).addLogListener('component.render.bindings', e => {
    console.log(`%cBindings: [${e.component.constructor.name}]`, 'font-style:italic;color:#ccc');
  }).addLogListener('component.render.binding', e => {
    console.log(`%c${e.binding.index}. ${Axial.proxy(e.binding.instance).toString()}~["${e.binding.property.key}"]:${e.binding.property.types.toString()}`, 'color:blue;padding-left:20px;');
  });
};

Axial.Component = AxialComponent;

module.exports = Axial;