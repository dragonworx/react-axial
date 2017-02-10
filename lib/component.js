const React = require('react');
const Axial = require('axial');

let _currentRenderingComponent = [];

function _stringify(value) {
  try {
    return JSON.stringify(value);
  } catch (e) {
    return '' + value;
  }
}

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
        if (state[path] !== nextState[path]) {
          isEqual = false;
          console.log(`%c[${this.constructor.name}.${path}] bindings changed`, 'color:red');
          break;
        }
      }
    }
    if (isEqual) {
      console.log(`%c[${this.constructor.name}] bindings are equal, should update: ${!isEqual}`, 'color:green');
    } else {
      console.log(`%c[${this.constructor.name}] bindings are not equal, should update: ${!isEqual}`, 'color:red');
    }
    return !isEqual;
  }

  /**
   * actual render method, swapped in constructor
   * @returns {XML}
   * @private
   */
  _render () {
    console.group(`RENDER:[${this.constructor.name}]`);

    // start capturing bindings accessed
    this.enterRender();

    // render output, rendering will create new bindings as instance properties are read (through temp global listener)
    const output = this.__render();

    // wrap in debugging component (optional)
    const r = Math.round(Math.random() * 255);
    const g = Math.round(Math.random() * 255);
    const b = Math.round(Math.random() * 255);
    const wrapper = output === null ? output : <div style={{backgroundColor:'rgb(' + [r,g,b].join(',') + ')',border:'5px dashed rgba(0,0,0,0.1)',margin:'5px',padding:'5px'}}>{output}</div>;

    // stop rendering and initialise/process new bindings
    this.exitRender();

    console.groupEnd();

    // return wrapped output
    return wrapper;
  }

  /**
   * global Axial.bind handler
   * this tells the component something was accessed.
   * since JavaScript is single-threaded, we can assume this is the currently rendering component.
   * @param eventData
   */
  captureBindingDuringRender (eventData) {
    // only use GET
    if (eventData.method === 'set') debugger;
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
      console.log(`%cCHANGE:[${eventData.property.path}] old: ${_stringify(eventData.oldValue)} new: ${_stringify(eventData.newValue)}`, 'color:blue');
      if (eventData.value === eventData.oldValue) {
        console.log(`%cEQUAL:[${eventData.property.path}]`, 'color:green');
        return;
      }
      console.log(`%cDIFFERENCE:[${eventData.property.path}]`, 'color:red');
      const state = {};
      state[eventData.property.path] = eventData.value;
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
    console.log(`%cBindings: [${this.constructor.name}]`, 'font-style:italic;color:#ccc');

    // create state from current bindings
    const state = {};
    const bindings = this._bindings;
    const l = bindings.length;
    for (let i = 0; i < l; i++) {
      let binding = bindings[i];
      console.log(`%c  [${binding.property.path}]:${binding.property.type.toString()}`, 'color:blue');
      state[binding._property.path] = binding.get();
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

Axial.Component = AxialComponent;

module.exports = Axial;