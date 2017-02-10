'use strict';

const CompositeDisposable = require('atom').CompositeDisposable;
const config = require('./config');
const map = require('./map');
const database = require('./database');
const colours = require('./colours');
const statusBar = require('./status-bar');
const mainView = require('./main-view');
const selectList = require('./select-list-view');
const cleanConfig = require('./common').cleanConfig;
const getModel = require('./common').getModel;
const getView = require('./common').getView;

let sidebarUnsubscriber;
let selectListUnsubscriber;

const activate = function _activate () {

  // clear old config settings (a bit of an hack)
  cleanConfig();

  // activate database
  database.activate();

  selectList.initialize();
  selectListUnsubscriber = database.subscribe(
    selectList.populate.bind(selectList)
  );

  colours.initialize();

  // add all disposables
  this.disposables = new CompositeDisposable(
    atom.commands.add(
      'atom-workspace',
      commandWorkspace.call(this)
    ),
    atom.commands.add(
      'project-viewer',
      commandsCore.call(this)
    ),
    atom.contextMenu.add(
      commandscontextMenu.call(this)
    ),
    atom.config.observe(
      'project-viewer.visibilityOption',
      observeVisibilityOption.bind(this)
    ),
    atom.config.observe(
      'project-viewer.visibilityActive',
      observeVisibilityActive.bind(this)
    ),
    atom.config.observe(
      'project-viewer.panelPosition',
      observePanelPosition.bind(this)
    ),
    atom.config.observe(
      'project-viewer.autoHide',
      observeAutoHide.bind(this)
    ),
    atom.config.observe(
      'project-viewer.hideHeader',
      observeHideHeader.bind(this)
    ),
    atom.config.onDidChange(
      'project-viewer.rootSortBy',
      observeRootSortBy.bind(this)
    ),
    atom.config.observe(
      'project-viewer.customTitleColor',
      observeCustomTitleColor.bind(this)
    ),
    atom.config.observe(
      'project-viewer.customHoverColor',
      observeCustomHoverColor.bind(this)
    ),
    atom.config.observe(
      'project-viewer.customSelectedColor',
      observeCustomSelectedColor.bind(this)
    )
  );
};

const deactivate = function _deactivate () {
  if (this.disposables) {
    this.disposables.dispose();
  }

  let view = map.get(this);
  if (!view) { return; }
  let panel = atom.workspace.panelForItem(view);
  if (!panel) { return; }

  sidebarUnsubscriber();
  selectListUnsubscriber();
  database.deactivate();
  colours.destroy();

  view.reset();
  panel.destroy();
};

const projectViewerService = function _projectViewerService () {
  return serviceExposer;
};

const provideStatusBar = function _provideStatusBar (service) {
  map.set(statusBar, service);
  this.disposables.add(
      atom.config.observe(
        'project-viewer.statusBar',
        observeStatusBar.bind(this)
      )
  )
};

const commandWorkspace = function _commandWorkspace () {
  return {
    'project-viewer:togglePanel': togglePanel.bind(this),
    'project-viewer:autohidePanel': autohidePanel.bind(this, undefined),
    'project-viewer:openEditor': openEditor.bind(this),
    'project-viewer:focusPanel': focusPanel.bind(this),
    'project-viewer:toggleSelectList': toggleSelectList,
    'project-viewer:clearState': clearState.bind(this),
    'project-viewer:clearStates': clearStates.bind(this),
    'project-viewer:openDatabase': openDatabase.bind(this),
    'project-viewer:migrate03x': migrate03x
  }
};

const commandsCore = function _commandsCore () {
  return {
    'core:move-up': function () { return this.traverse.call(this, '☝️'); },
    'core:move-down': function () { return this.traverse.call(this, '👇'); },
    'core:move-left': function () { return this.setAction.call(this, '📪') },
    'core:move-right': function () { return this.setAction.call(this, '📭') },
    'core:confirm': function () { return this.setAction.call(this, '✅') }
  }
};

const commandscontextMenu = function _commandscontextMenu () {
  return {
      'project-viewer': [
        {
          command: 'project-viewer:openEditor',
          created: function (evt) {
            const model = getModel(evt.target);
            if (model) {
              this.label = `Edit ${model.name}...`;
            }
          },
          shouldDisplay: function (evt) {
            const view = getView(evt.target);
            return map.has(view);
          }
        }
      ]
  };
};

const observeVisibilityOption = function _observeVisibilityOption (option) {
  if (option === 'Remember state') {
    const vActive = atom.config.get('project-viewer.visibilityActive');
    const view = map.get(this);
    if (!view) { return; }
    const panel = atom.workspace.panelForItem(view);
    if (!panel) { return; }
    (vActive && !panel.visible) ? panel.show() : null;
    atom.config.set('project-viewer.visibilityActive', panel.visible);
  }
};

const observeVisibilityActive = function observeVisibilityActive (option) {
  const vOption = atom.config.get('project-viewer.visibilityOption');
  if (vOption === 'Display on startup') { return; }
  const view = map.get(this);
  if (!view) { return; }
  const panel = atom.workspace.panelForItem(view);
  if (!panel) { return; }
  option ? panel.show() : panel.hide();
};

const buildPanel = function _buildPanel (options) {
  let panel = {
    item: this,
    visible: atom.config.get('project-viewer.visibilityActive')
  };

  if (options.priority) {
    panel.priority = 0;
  }

  if (options.left) {
    atom.workspace.addLeftPanel(panel);
  }

  if (options.right) {
    atom.workspace.addRightPanel(panel);
  }

  if (options.invertResizer) {
    this.invertResizer(true);
  }
};

const addPanel = function _addPanel (options) {
  if (atom.packages.getActivePackages().length > 0) {
    buildPanel.call(this, options);
    return;
  }
  atom.packages.onDidActivateInitialPackages(
    buildPanel.bind(this, options)
  );
};

const observePanelPosition = function _observePanelPosition (option) {
  let view = map.get(this);
  let panel;
  if (!view) {
    view = mainView.createView();
    view.initialize();
    map.set(this, view);
  } else {
    panel = atom.workspace.panelForItem(view);
  }

  if (panel) {
    panel.destroy();
    sidebarUnsubscriber();
  }

  if (option === 'Left (first)') {
    addPanel.call(view, { left: true, priority: true });
  }
  else if (option === 'Left (last)') {
    addPanel.call(view, { left: true });
  }
  else if (option === 'Right (first)') {
    addPanel.call(view, { right: true, priority: true });
  }
  else if (option === 'Right (last)') {
    addPanel.call(view, { right: true });
  }

  sidebarUnsubscriber = database.subscribe(view.populate.bind(view));
  database.refresh();
};

const observeAutoHide = function _observeAutoHide (option) {
  autohidePanel.call(this, option);
};

const observeHideHeader = function _observeHideHeader (option) {
  const view = map.get(this);
  if (!view) { return; }
  view.toggleTitle(option);
};

const observeCustomTitleColor = function _observeCustomTitleColor (value) {
  if (!value) {
    colours.removeRule('title');
    return;
  }
  colours.addRule('title', 'title', value);
};

const observeCustomHoverColor = function _observeCustomHoverColor (value) {
  if (!value) {
    colours.removeRule('projectHover');
    colours.removeRule('projectHoverBefore');
    return;
  }
  colours.addRule('projectHover', 'project-hover', value);
  colours.addRule('projectHoverBefore', 'project-hover-before', value);
};

const observeCustomSelectedColor = function _observeCustomSelectedColor (value) {
  if (!value) {
    colours.removeRule('projectSelected');
    return;
  }
  colours.addRule('projectSelected', 'project-selected', value);
};

const observeStatusBar = function _observeStatusBar (value) {
  statusBar.toggle.call(statusBar, value);
};

const observeRootSortBy = function _observeRootSortBy () {
  let view = map.get(this);
  if (!view) { return; }
  database.refresh();
};

const togglePanel = function _togglePanel () {
  let view = map.get(this);

  if (!view) {
    return;
  }

  const panel = atom.workspace.panelForItem(view);
  panel.visible ? panel.hide() : panel.show();

  if (atom.config.get('project-viewer.visibilityOption') === 'Remember state') {
    atom.config.set('project-viewer.visibilityActive', panel.visible);
  }
};

const migrate03x = function _migrate03x () {
  database.migrate03x();
};

const toggleSelectList = function _toggleSelectList () {
  selectList.togglePanel();
};

const autohidePanel = function _autohidePanel (option) {
  let view = map.get(this);

  if (!view) { return; }

  view.autohide(option);
};

const openEditor = function _openEditor (evt) {
  const view = map.get(this);
  if (!view) { return; }
  const model = getModel(evt.target);
  view.openEditor(model);
};

const focusPanel = function _focusPanel () {
  const view = map.get(this);
  if (!view) { return false; }
  view.toggleFocus();
};

const openDatabase = function _openDatabase () {
  database.openDatabase();
};

const clearState = function _clearState () {};

const clearStates = function _clearStates () {};

const createGroup = function _createGroup () {};

const createProject = function _createProject () {};

const serviceExposer = Object.create(null);

serviceExposer.createGroup = createGroup;
serviceExposer.createProject = createProject;

const main = Object.create(null);

main.activate = activate;
main.config = config;
main.deactivate = deactivate;
main.projectViewerService = projectViewerService;
main.provideStatusBar = provideStatusBar;

/**
*/
module.exports = main;