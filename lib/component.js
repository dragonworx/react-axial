const React = require('react');
const Axial = require('axial');
const PROXY_KEY = Axial.PROXY_KEY;

const _currentRenderingComponent = [];

class AxialComponent extends React.Component {
  constructor (...args) {
    super(...args);

    this._bindings = [];

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
        if (currentValue instanceof Axial.Instance.constructor) {
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
    } else {
      debugger
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
    const bindings = this._bindings;
    const l = bindings.length;
    for (let i = 0; i < l; i++) {
      bindings[i].dispose();
    }
    bindings.length = 0;

    // bind to global instance property change events
    Axial.bind(this.captureBindingDuringRender.bind(this));

    // become the currently rendering component
    _currentRenderingComponent.push(this);
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
}

AxialComponent.debug = false;
AxialComponent.onDebugRender = null;

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