import { keymap } from 'prosemirror-keymap';
import { undo, redo, history } from 'prosemirror-history';
import { toggleMark, wrapIn, chainCommands, exitCode, setBlockType, joinUp, joinDown, lift, selectParentNode, baseKeymap } from 'prosemirror-commands';
import { NodeSelection, Plugin } from 'prosemirror-state';
import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';
import { icons, MenuItem, wrapItem, blockTypeItem, Dropdown, DropdownSubmenu, joinUpItem, liftItem, selectParentNodeItem, undoItem, redoItem, menuBar } from 'prosemirror-menu';
import { wrapInList, splitListItem, liftListItem, sinkListItem } from 'prosemirror-schema-list';
import { undoInputRule, smartQuotes, ellipsis, emDash, wrappingInputRule, textblockTypeInputRule, inputRules } from 'prosemirror-inputrules';

var prefix = "ProseMirror-prompt";

function openPrompt(options) {
  var wrapper = document.body.appendChild(document.createElement("div"));
  wrapper.className = prefix;

  var mouseOutside = function (e) { if (!wrapper.contains(e.target)) { close(); } };
  setTimeout(function () { return window.addEventListener("mousedown", mouseOutside); }, 50);
  var close = function () {
    window.removeEventListener("mousedown", mouseOutside);
    if (wrapper.parentNode) { wrapper.parentNode.removeChild(wrapper); }
  };

  var domFields = [];
  for (var name in options.fields) { domFields.push(options.fields[name].render()); }

  var submitButton = document.createElement("button");
  submitButton.type = "submit";
  submitButton.className = prefix + "-submit";
  submitButton.textContent = "OK";
  var cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = prefix + "-cancel";
  cancelButton.textContent = "Cancel";
  cancelButton.addEventListener("click", close);

  var form = wrapper.appendChild(document.createElement("form"));
  if (options.title) { form.appendChild(document.createElement("h5")).textContent = options.title; }
  domFields.forEach(function (field) {
    form.appendChild(document.createElement("div")).appendChild(field);
  });
  var buttons = form.appendChild(document.createElement("div"));
  buttons.className = prefix + "-buttons";
  buttons.appendChild(submitButton);
  buttons.appendChild(document.createTextNode(" "));
  buttons.appendChild(cancelButton);

  var box = wrapper.getBoundingClientRect();
  wrapper.style.top = ((window.innerHeight - box.height) / 2) + "px";
  wrapper.style.left = ((window.innerWidth - box.width) / 2) + "px";

  var submit = function () {
    var params = getValues(options.fields, domFields);
    if (params) {
      close();
      options.callback(params);
    }
  };

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    submit();
  });

  form.addEventListener("keydown", function (e) {
    if (e.keyCode == 27) {
      e.preventDefault();
      close();
    } else if (e.keyCode == 13 && !(e.ctrlKey || e.metaKey || e.shiftKey)) {
      e.preventDefault();
      submit();
    } else if (e.keyCode == 9) {
      window.setTimeout(function () {
        if (!wrapper.contains(document.activeElement)) { close(); }
      }, 500);
    }
  });

  var input = form.elements[0];
  if (input) { input.focus(); }
}

function getValues(fields, domFields) {
  var result = Object.create(null), i = 0;
  for (var name in fields) {
    var field = fields[name], dom = domFields[i++];
    var value = field.read(dom), bad = field.validate(value);
    if (bad) {
      reportInvalid(dom, bad);
      return null
    }
    result[name] = field.clean(value);
  }
  return result
}

function reportInvalid(dom, message) {
  // FIXME this is awful and needs a lot more work
  var parent = dom.parentNode;
  var msg = parent.appendChild(document.createElement("div"));
  msg.style.left = (dom.offsetLeft + dom.offsetWidth + 2) + "px";
  msg.style.top = (dom.offsetTop - 5) + "px";
  msg.className = "ProseMirror-invalid";
  msg.textContent = message;
  setTimeout(function () { return parent.removeChild(msg); }, 1500);
}

// ::- The type of field that `FieldPrompt` expects to be passed to it.
var Field = function Field(options) { this.options = options; };

// render:: (state: EditorState, props: Object) → dom.Node
// Render the field to the DOM. Should be implemented by all subclasses.

// :: (dom.Node) → any
// Read the field's value from its DOM node.
Field.prototype.read = function read (dom) { return dom.value };

// :: (any) → ?string
// A field-type-specific validation function.
Field.prototype.validateType = function validateType (_value) {};

Field.prototype.validate = function validate (value) {
  if (!value && this.options.required)
    { return "Required field" }
  return this.validateType(value) || (this.options.validate && this.options.validate(value))
};

Field.prototype.clean = function clean (value) {
  return this.options.clean ? this.options.clean(value) : value
};

// ::- A field class for single-line text fields.
var TextField = /*@__PURE__*/(function (Field) {
  function TextField () {
    Field.apply(this, arguments);
  }

  if ( Field ) TextField.__proto__ = Field;
  TextField.prototype = Object.create( Field && Field.prototype );
  TextField.prototype.constructor = TextField;

  TextField.prototype.render = function render () {
    var input = document.createElement("input");
    input.type = "text";
    input.placeholder = this.options.label;
    input.value = this.options.value || "";
    input.autocomplete = "off";
    return input
  };

  return TextField;
}(Field));

// Helpers to create specific types of items

function canInsert(state, nodeType) {
  var $from = state.selection.$from;
  for (var d = $from.depth; d >= 0; d--) {
    var index = $from.index(d);
    if ($from.node(d).canReplaceWith(index, index, nodeType)) { return true }
  }
  return false
}

function insertImageItem(nodeType) {
  return new MenuItem({
    title: "Insert image",
    label: "Image",
    enable: function enable(state) { return canInsert(state, nodeType) },
    run: function run(state, _, view) {
      var ref = state.selection;
      var from = ref.from;
      var to = ref.to;
      var attrs = null;
      if (state.selection instanceof NodeSelection && state.selection.node.type == nodeType)
        { attrs = state.selection.node.attrs; }
      openPrompt({
        title: "Insert image",
        fields: {
          src: new TextField({label: "Location", required: true, value: attrs && attrs.src}),
          title: new TextField({label: "Title", value: attrs && attrs.title}),
          alt: new TextField({label: "Description",
                              value: attrs ? attrs.alt : state.doc.textBetween(from, to, " ")})
        },
        callback: function callback(attrs) {
          view.dispatch(view.state.tr.replaceSelectionWith(nodeType.createAndFill(attrs)));
          view.focus();
        }
      });
    }
  })
}

function cmdItem(cmd, options) {
  var passedOptions = {
    label: options.title,
    run: cmd
  };
  for (var prop in options) { passedOptions[prop] = options[prop]; }
  if ((!options.enable || options.enable === true) && !options.select)
    { passedOptions[options.enable ? "enable" : "select"] = function (state) { return cmd(state); }; }

  return new MenuItem(passedOptions)
}

function markActive(state, type) {
  var ref = state.selection;
  var from = ref.from;
  var $from = ref.$from;
  var to = ref.to;
  var empty = ref.empty;
  if (empty) { return type.isInSet(state.storedMarks || $from.marks()) }
  else { return state.doc.rangeHasMark(from, to, type) }
}

function markItem(markType, options) {
  var passedOptions = {
    active: function active(state) { return markActive(state, markType) },
    enable: true
  };
  for (var prop in options) { passedOptions[prop] = options[prop]; }
  return cmdItem(toggleMark(markType), passedOptions)
}

function linkItem(markType) {
  return new MenuItem({
    title: "Add or remove link",
    icon: icons.link,
    active: function active(state) { return markActive(state, markType) },
    enable: function enable(state) { return !state.selection.empty },
    run: function run(state, dispatch, view) {
      if (markActive(state, markType)) {
        toggleMark(markType)(state, dispatch);
        return true
      }
      openPrompt({
        title: "Create a link",
        fields: {
          href: new TextField({
            label: "Link target",
            required: true
          }),
          title: new TextField({label: "Title"})
        },
        callback: function callback(attrs) {
          toggleMark(markType, attrs)(view.state, view.dispatch);
          view.focus();
        }
      });
    }
  })
}

function wrapListItem(nodeType, options) {
  return cmdItem(wrapInList(nodeType, options.attrs), options)
}

// :: (Schema) → Object
// Given a schema, look for default mark and node types in it and
// return an object with relevant menu items relating to those marks:
//
// **`toggleStrong`**`: MenuItem`
//   : A menu item to toggle the [strong mark](#schema-basic.StrongMark).
//
// **`toggleEm`**`: MenuItem`
//   : A menu item to toggle the [emphasis mark](#schema-basic.EmMark).
//
// **`toggleCode`**`: MenuItem`
//   : A menu item to toggle the [code font mark](#schema-basic.CodeMark).
//
// **`toggleLink`**`: MenuItem`
//   : A menu item to toggle the [link mark](#schema-basic.LinkMark).
//
// **`insertImage`**`: MenuItem`
//   : A menu item to insert an [image](#schema-basic.Image).
//
// **`wrapBulletList`**`: MenuItem`
//   : A menu item to wrap the selection in a [bullet list](#schema-list.BulletList).
//
// **`wrapOrderedList`**`: MenuItem`
//   : A menu item to wrap the selection in an [ordered list](#schema-list.OrderedList).
//
// **`wrapBlockQuote`**`: MenuItem`
//   : A menu item to wrap the selection in a [block quote](#schema-basic.BlockQuote).
//
// **`makeParagraph`**`: MenuItem`
//   : A menu item to set the current textblock to be a normal
//     [paragraph](#schema-basic.Paragraph).
//
// **`makeCodeBlock`**`: MenuItem`
//   : A menu item to set the current textblock to be a
//     [code block](#schema-basic.CodeBlock).
//
// **`makeHead[N]`**`: MenuItem`
//   : Where _N_ is 1 to 6. Menu items to set the current textblock to
//     be a [heading](#schema-basic.Heading) of level _N_.
//
// **`insertHorizontalRule`**`: MenuItem`
//   : A menu item to insert a horizontal rule.
//
// The return value also contains some prefabricated menu elements and
// menus, that you can use instead of composing your own menu from
// scratch:
//
// **`insertMenu`**`: Dropdown`
//   : A dropdown containing the `insertImage` and
//     `insertHorizontalRule` items.
//
// **`typeMenu`**`: Dropdown`
//   : A dropdown containing the items for making the current
//     textblock a paragraph, code block, or heading.
//
// **`fullMenu`**`: [[MenuElement]]`
//   : An array of arrays of menu elements for use as the full menu
//     for, for example the [menu bar](https://github.com/prosemirror/prosemirror-menu#user-content-menubar).
function buildMenuItems(schema) {
  var r = {}, type;
  if (type = schema.marks.strong)
    { r.toggleStrong = markItem(type, {title: "Toggle strong style", icon: icons.strong}); }
  if (type = schema.marks.em)
    { r.toggleEm = markItem(type, {title: "Toggle emphasis", icon: icons.em}); }
  if (type = schema.marks.code)
    { r.toggleCode = markItem(type, {title: "Toggle code font", icon: icons.code}); }
  if (type = schema.marks.link)
    { r.toggleLink = linkItem(type); }

  if (type = schema.nodes.image)
    { r.insertImage = insertImageItem(type); }
  if (type = schema.nodes.bullet_list)
    { r.wrapBulletList = wrapListItem(type, {
      title: "Wrap in bullet list",
      icon: icons.bulletList
    }); }
  if (type = schema.nodes.ordered_list)
    { r.wrapOrderedList = wrapListItem(type, {
      title: "Wrap in ordered list",
      icon: icons.orderedList
    }); }
  if (type = schema.nodes.blockquote)
    { r.wrapBlockQuote = wrapItem(type, {
      title: "Wrap in block quote",
      icon: icons.blockquote
    }); }
  if (type = schema.nodes.paragraph)
    { r.makeParagraph = blockTypeItem(type, {
      title: "Change to paragraph",
      label: "Plain"
    }); }
  if (type = schema.nodes.code_block)
    { r.makeCodeBlock = blockTypeItem(type, {
      title: "Change to code block",
      label: "Code"
    }); }
  if (type = schema.nodes.heading)
    { for (var i = 1; i <= 10; i++)
      { r["makeHead" + i] = blockTypeItem(type, {
        title: "Change to heading " + i,
        label: "Level " + i,
        attrs: {level: i}
      }); } }
  if (type = schema.nodes.horizontal_rule) {
    var hr = type;
    r.insertHorizontalRule = new MenuItem({
      title: "Insert horizontal rule",
      label: "Horizontal rule",
      enable: function enable(state) { return canInsert(state, hr) },
      run: function run(state, dispatch) { dispatch(state.tr.replaceSelectionWith(hr.create())); }
    });
  }

  var cut = function (arr) { return arr.filter(function (x) { return x; }); };
  r.insertMenu = new Dropdown(cut([r.insertImage, r.insertHorizontalRule]), {label: "Insert"});
  r.typeMenu = new Dropdown(cut([r.makeParagraph, r.makeCodeBlock, r.makeHead1 && new DropdownSubmenu(cut([
    r.makeHead1, r.makeHead2, r.makeHead3, r.makeHead4, r.makeHead5, r.makeHead6
  ]), {label: "Heading"})]), {label: "Type..."});

  r.inlineMenu = [cut([r.toggleStrong, r.toggleEm, r.toggleCode, r.toggleLink])];
  r.blockMenu = [cut([r.wrapBulletList, r.wrapOrderedList, r.wrapBlockQuote, joinUpItem,
                      liftItem, selectParentNodeItem])];
  r.fullMenu = r.inlineMenu.concat([[r.insertMenu, r.typeMenu]], [[undoItem, redoItem]], r.blockMenu);

  return r
}

var mac = typeof navigator != "undefined" ? /Mac/.test(navigator.platform) : false;

// :: (Schema, ?Object) → Object
// Inspect the given schema looking for marks and nodes from the
// basic schema, and if found, add key bindings related to them.
// This will add:
//
// * **Mod-b** for toggling [strong](#schema-basic.StrongMark)
// * **Mod-i** for toggling [emphasis](#schema-basic.EmMark)
// * **Mod-`** for toggling [code font](#schema-basic.CodeMark)
// * **Ctrl-Shift-0** for making the current textblock a paragraph
// * **Ctrl-Shift-1** to **Ctrl-Shift-Digit6** for making the current
//   textblock a heading of the corresponding level
// * **Ctrl-Shift-Backslash** to make the current textblock a code block
// * **Ctrl-Shift-8** to wrap the selection in an ordered list
// * **Ctrl-Shift-9** to wrap the selection in a bullet list
// * **Ctrl->** to wrap the selection in a block quote
// * **Enter** to split a non-empty textblock in a list item while at
//   the same time splitting the list item
// * **Mod-Enter** to insert a hard break
// * **Mod-_** to insert a horizontal rule
// * **Backspace** to undo an input rule
// * **Alt-ArrowUp** to `joinUp`
// * **Alt-ArrowDown** to `joinDown`
// * **Mod-BracketLeft** to `lift`
// * **Escape** to `selectParentNode`
//
// You can suppress or map these bindings by passing a `mapKeys`
// argument, which maps key names (say `"Mod-B"` to either `false`, to
// remove the binding, or a new key name string.
function buildKeymap(schema, mapKeys) {
  var keys = {}, type;
  function bind(key, cmd) {
    if (mapKeys) {
      var mapped = mapKeys[key];
      if (mapped === false) { return }
      if (mapped) { key = mapped; }
    }
    keys[key] = cmd;
  }


  bind("Mod-z", undo);
  bind("Shift-Mod-z", redo);
  bind("Backspace", undoInputRule);
  if (!mac) { bind("Mod-y", redo); }

  bind("Alt-ArrowUp", joinUp);
  bind("Alt-ArrowDown", joinDown);
  bind("Mod-BracketLeft", lift);
  bind("Escape", selectParentNode);

  if (type = schema.marks.strong) {
    bind("Mod-b", toggleMark(type));
    bind("Mod-B", toggleMark(type));
  }
  if (type = schema.marks.em) {
    bind("Mod-i", toggleMark(type));
    bind("Mod-I", toggleMark(type));
  }
  if (type = schema.marks.code)
    { bind("Mod-`", toggleMark(type)); }

  if (type = schema.nodes.bullet_list)
    { bind("Shift-Ctrl-8", wrapInList(type)); }
  if (type = schema.nodes.ordered_list)
    { bind("Shift-Ctrl-9", wrapInList(type)); }
  if (type = schema.nodes.blockquote)
    { bind("Ctrl->", wrapIn(type)); }
  if (type = schema.nodes.hard_break) {
    var br = type, cmd = chainCommands(exitCode, function (state, dispatch) {
      dispatch(state.tr.replaceSelectionWith(br.create()).scrollIntoView());
      return true
    });
    bind("Mod-Enter", cmd);
    bind("Shift-Enter", cmd);
    if (mac) { bind("Ctrl-Enter", cmd); }
  }
  if (type = schema.nodes.list_item) {
    bind("Enter", splitListItem(type));
    bind("Mod-[", liftListItem(type));
    bind("Mod-]", sinkListItem(type));
  }
  if (type = schema.nodes.paragraph)
    { bind("Shift-Ctrl-0", setBlockType(type)); }
  if (type = schema.nodes.code_block)
    { bind("Shift-Ctrl-\\", setBlockType(type)); }
  if (type = schema.nodes.heading)
    { for (var i = 1; i <= 6; i++) { bind("Shift-Ctrl-" + i, setBlockType(type, {level: i})); } }
  if (type = schema.nodes.horizontal_rule) {
    var hr = type;
    bind("Mod-_", function (state, dispatch) {
      dispatch(state.tr.replaceSelectionWith(hr.create()).scrollIntoView());
      return true
    });
  }

  return keys
}

// : (NodeType) → InputRule
// Given a blockquote node type, returns an input rule that turns `"> "`
// at the start of a textblock into a blockquote.
function blockQuoteRule(nodeType) {
  return wrappingInputRule(/^\s*>\s$/, nodeType)
}

// : (NodeType) → InputRule
// Given a list node type, returns an input rule that turns a number
// followed by a dot at the start of a textblock into an ordered list.
function orderedListRule(nodeType) {
  return wrappingInputRule(/^(\d+)\.\s$/, nodeType, function (match) { return ({order: +match[1]}); },
                           function (match, node) { return node.childCount + node.attrs.order == +match[1]; })
}

// : (NodeType) → InputRule
// Given a list node type, returns an input rule that turns a bullet
// (dash, plush, or asterisk) at the start of a textblock into a
// bullet list.
function bulletListRule(nodeType) {
  return wrappingInputRule(/^\s*([-+*])\s$/, nodeType)
}

// : (NodeType) → InputRule
// Given a code block node type, returns an input rule that turns a
// textblock starting with three backticks into a code block.
function codeBlockRule(nodeType) {
  return textblockTypeInputRule(/^```$/, nodeType)
}

// : (NodeType, number) → InputRule
// Given a node type and a maximum level, creates an input rule that
// turns up to that number of `#` characters followed by a space at
// the start of a textblock into a heading whose level corresponds to
// the number of `#` signs.
function headingRule(nodeType, maxLevel) {
  return textblockTypeInputRule(new RegExp("^(#{1," + maxLevel + "})\\s$"),
                                nodeType, function (match) { return ({level: match[1].length}); })
}

// : (Schema) → Plugin
// A set of input rules for creating the basic block quotes, lists,
// code blocks, and heading.
function buildInputRules(schema) {
  var rules = smartQuotes.concat(ellipsis, emDash), type;
  if (type = schema.nodes.blockquote) { rules.push(blockQuoteRule(type)); }
  if (type = schema.nodes.ordered_list) { rules.push(orderedListRule(type)); }
  if (type = schema.nodes.bullet_list) { rules.push(bulletListRule(type)); }
  if (type = schema.nodes.code_block) { rules.push(codeBlockRule(type)); }
  if (type = schema.nodes.heading) { rules.push(headingRule(type, 6)); }
  return inputRules({rules: rules})
}

// !! This module exports helper functions for deriving a set of basic
// menu items, input rules, or key bindings from a schema. These
// values need to know about the schema for two reasons—they need
// access to specific instances of node and mark types, and they need
// to know which of the node and mark types that they know about are
// actually present in the schema.
//
// The `exampleSetup` plugin ties these together into a plugin that
// will automatically enable this basic functionality in an editor.

// :: (Object) → [Plugin]
// A convenience plugin that bundles together a simple menu with basic
// key bindings, input rules, and styling for the example schema.
// Probably only useful for quickly setting up a passable
// editor—you'll need more control over your settings in most
// real-world situations.
//
//   options::- The following options are recognized:
//
//     schema:: Schema
//     The schema to generate key bindings and menu items for.
//
//     mapKeys:: ?Object
//     Can be used to [adjust](#example-setup.buildKeymap) the key bindings created.
//
//     menuBar:: ?bool
//     Set to false to disable the menu bar.
//
//     history:: ?bool
//     Set to false to disable the history plugin.
//
//     floatingMenu:: ?bool
//     Set to false to make the menu bar non-floating.
//
//     menuContent:: [[MenuItem]]
//     Can be used to override the menu content.
function exampleSetup(options) {
  var plugins = [
    buildInputRules(options.schema),
    keymap(buildKeymap(options.schema, options.mapKeys)),
    keymap(baseKeymap),
    dropCursor(),
    gapCursor()
  ];
  if (options.menuBar !== false)
    { plugins.push(menuBar({floating: options.floatingMenu !== false,
                          content: options.menuContent || buildMenuItems(options.schema).fullMenu})); }
  if (options.history !== false)
    { plugins.push(history()); }

  return plugins.concat(new Plugin({
    props: {
      attributes: {class: "ProseMirror-example-setup-style"}
    }
  }))
}

export { buildInputRules, buildKeymap, buildMenuItems, exampleSetup };
//# sourceMappingURL=index.es.js.map
