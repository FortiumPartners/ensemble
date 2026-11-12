var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __hasOwnProp = Object.prototype.hasOwnProperty;
function __accessProp(key) {
  return this[key];
}
var __toESMCache_node;
var __toESMCache_esm;
var __toESM = (mod, isNodeMode, target) => {
  var canCache = mod != null && typeof mod === "object";
  if (canCache) {
    var cache = isNodeMode ? __toESMCache_node ??= new WeakMap : __toESMCache_esm ??= new WeakMap;
    var cached = cache.get(mod);
    if (cached)
      return cached;
  }
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to = isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", { value: mod, enumerable: true }) : target;
  if (mod && typeof mod === "object" || typeof mod === "function") {
    for (let key of __getOwnPropNames(mod))
      if (!__hasOwnProp.call(to, key))
        __defProp(to, key, {
          get: __accessProp.bind(mod, key),
          enumerable: true
        });
  }
  if (canCache)
    cache.set(mod, to);
  return to;
};
var __toCommonJS = (from) => {
  var entry = (__moduleCache ??= new WeakMap).get(from), desc;
  if (entry)
    return entry;
  entry = __defProp({}, "__esModule", { value: true });
  if (from && typeof from === "object" || typeof from === "function") {
    for (var key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(entry, key))
        __defProp(entry, key, {
          get: __accessProp.bind(from, key),
          enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
        });
  }
  __moduleCache.set(from, entry);
  return entry;
};
var __moduleCache;
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};

// ../agent-core/dist/new-feature/types.js
var require_types = __commonJS(function(exports2) {
  Object.defineProperty(exports2, "__esModule", { value: true });
  exports2.STAGE_ORDER = undefined;
  exports2.STAGE_ORDER = [
    "prd_create",
    "prd_refine",
    "trd_create",
    "trd_refine",
    "beads_plan",
    "implementation_approval",
    "implementation",
    "pr_approval",
    "pr_create",
    "done"
  ];
});

// ../agent-core/dist/lifecycle-hooks/types.js
var require_types2 = __commonJS(function(exports2) {
  Object.defineProperty(exports2, "__esModule", { value: true });
  exports2.DEFAULT_PROMPT_TIMEOUT_MS = exports2.DEFAULT_SHELL_TIMEOUT_MS = undefined;
  exports2.DEFAULT_SHELL_TIMEOUT_MS = 5000;
  exports2.DEFAULT_PROMPT_TIMEOUT_MS = 30000;
});

// ../../node_modules/js-yaml/lib/common.js
var require_common = __commonJS(function(exports2, module2) {
  function isNothing(subject) {
    return typeof subject === "undefined" || subject === null;
  }
  function isObject(subject) {
    return typeof subject === "object" && subject !== null;
  }
  function toArray(sequence) {
    if (Array.isArray(sequence))
      return sequence;
    else if (isNothing(sequence))
      return [];
    return [sequence];
  }
  function extend(target, source) {
    var index, length, key, sourceKeys;
    if (source) {
      sourceKeys = Object.keys(source);
      for (index = 0, length = sourceKeys.length;index < length; index += 1) {
        key = sourceKeys[index];
        target[key] = source[key];
      }
    }
    return target;
  }
  function repeat(string, count) {
    var result = "", cycle;
    for (cycle = 0;cycle < count; cycle += 1) {
      result += string;
    }
    return result;
  }
  function isNegativeZero(number) {
    return number === 0 && Number.NEGATIVE_INFINITY === 1 / number;
  }
  module2.exports.isNothing = isNothing;
  module2.exports.isObject = isObject;
  module2.exports.toArray = toArray;
  module2.exports.repeat = repeat;
  module2.exports.isNegativeZero = isNegativeZero;
  module2.exports.extend = extend;
});

// ../../node_modules/js-yaml/lib/exception.js
var require_exception = __commonJS(function(exports2, module2) {
  function formatError(exception, compact) {
    var where = "", message = exception.reason || "(unknown reason)";
    if (!exception.mark)
      return message;
    if (exception.mark.name) {
      where += 'in "' + exception.mark.name + '" ';
    }
    where += "(" + (exception.mark.line + 1) + ":" + (exception.mark.column + 1) + ")";
    if (!compact && exception.mark.snippet) {
      where += `

` + exception.mark.snippet;
    }
    return message + " " + where;
  }
  function YAMLException(reason, mark) {
    Error.call(this);
    this.name = "YAMLException";
    this.reason = reason;
    this.mark = mark;
    this.message = formatError(this, false);
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    } else {
      this.stack = new Error().stack || "";
    }
  }
  YAMLException.prototype = Object.create(Error.prototype);
  YAMLException.prototype.constructor = YAMLException;
  YAMLException.prototype.toString = function toString(compact) {
    return this.name + ": " + formatError(this, compact);
  };
  module2.exports = YAMLException;
});

// ../../node_modules/js-yaml/lib/snippet.js
var require_snippet = __commonJS(function(exports2, module2) {
  var common = require_common();
  function getLine(buffer, lineStart, lineEnd, position, maxLineLength) {
    var head = "";
    var tail = "";
    var maxHalfLength = Math.floor(maxLineLength / 2) - 1;
    if (position - lineStart > maxHalfLength) {
      head = " ... ";
      lineStart = position - maxHalfLength + head.length;
    }
    if (lineEnd - position > maxHalfLength) {
      tail = " ...";
      lineEnd = position + maxHalfLength - tail.length;
    }
    return {
      str: head + buffer.slice(lineStart, lineEnd).replace(/\t/g, "→") + tail,
      pos: position - lineStart + head.length
    };
  }
  function padStart(string, max) {
    return common.repeat(" ", max - string.length) + string;
  }
  function makeSnippet(mark, options) {
    options = Object.create(options || null);
    if (!mark.buffer)
      return null;
    if (!options.maxLength)
      options.maxLength = 79;
    if (typeof options.indent !== "number")
      options.indent = 1;
    if (typeof options.linesBefore !== "number")
      options.linesBefore = 3;
    if (typeof options.linesAfter !== "number")
      options.linesAfter = 2;
    var re = /\r?\n|\r|\0/g;
    var lineStarts = [0];
    var lineEnds = [];
    var match;
    var foundLineNo = -1;
    while (match = re.exec(mark.buffer)) {
      lineEnds.push(match.index);
      lineStarts.push(match.index + match[0].length);
      if (mark.position <= match.index && foundLineNo < 0) {
        foundLineNo = lineStarts.length - 2;
      }
    }
    if (foundLineNo < 0)
      foundLineNo = lineStarts.length - 1;
    var result = "", i, line;
    var lineNoLength = Math.min(mark.line + options.linesAfter, lineEnds.length).toString().length;
    var maxLineLength = options.maxLength - (options.indent + lineNoLength + 3);
    for (i = 1;i <= options.linesBefore; i++) {
      if (foundLineNo - i < 0)
        break;
      line = getLine(mark.buffer, lineStarts[foundLineNo - i], lineEnds[foundLineNo - i], mark.position - (lineStarts[foundLineNo] - lineStarts[foundLineNo - i]), maxLineLength);
      result = common.repeat(" ", options.indent) + padStart((mark.line - i + 1).toString(), lineNoLength) + " | " + line.str + `
` + result;
    }
    line = getLine(mark.buffer, lineStarts[foundLineNo], lineEnds[foundLineNo], mark.position, maxLineLength);
    result += common.repeat(" ", options.indent) + padStart((mark.line + 1).toString(), lineNoLength) + " | " + line.str + `
`;
    result += common.repeat("-", options.indent + lineNoLength + 3 + line.pos) + "^" + `
`;
    for (i = 1;i <= options.linesAfter; i++) {
      if (foundLineNo + i >= lineEnds.length)
        break;
      line = getLine(mark.buffer, lineStarts[foundLineNo + i], lineEnds[foundLineNo + i], mark.position - (lineStarts[foundLineNo] - lineStarts[foundLineNo + i]), maxLineLength);
      result += common.repeat(" ", options.indent) + padStart((mark.line + i + 1).toString(), lineNoLength) + " | " + line.str + `
`;
    }
    return result.replace(/\n$/, "");
  }
  module2.exports = makeSnippet;
});

// ../../node_modules/js-yaml/lib/type.js
var require_type = __commonJS(function(exports2, module2) {
  var YAMLException = require_exception();
  var TYPE_CONSTRUCTOR_OPTIONS = [
    "kind",
    "multi",
    "resolve",
    "construct",
    "instanceOf",
    "predicate",
    "represent",
    "representName",
    "defaultStyle",
    "styleAliases"
  ];
  var YAML_NODE_KINDS = [
    "scalar",
    "sequence",
    "mapping"
  ];
  function compileStyleAliases(map) {
    var result = {};
    if (map !== null) {
      Object.keys(map).forEach(function(style) {
        map[style].forEach(function(alias) {
          result[String(alias)] = style;
        });
      });
    }
    return result;
  }
  function Type(tag, options) {
    options = options || {};
    Object.keys(options).forEach(function(name) {
      if (TYPE_CONSTRUCTOR_OPTIONS.indexOf(name) === -1) {
        throw new YAMLException('Unknown option "' + name + '" is met in definition of "' + tag + '" YAML type.');
      }
    });
    this.options = options;
    this.tag = tag;
    this.kind = options["kind"] || null;
    this.resolve = options["resolve"] || function() {
      return true;
    };
    this.construct = options["construct"] || function(data) {
      return data;
    };
    this.instanceOf = options["instanceOf"] || null;
    this.predicate = options["predicate"] || null;
    this.represent = options["represent"] || null;
    this.representName = options["representName"] || null;
    this.defaultStyle = options["defaultStyle"] || null;
    this.multi = options["multi"] || false;
    this.styleAliases = compileStyleAliases(options["styleAliases"] || null);
    if (YAML_NODE_KINDS.indexOf(this.kind) === -1) {
      throw new YAMLException('Unknown kind "' + this.kind + '" is specified for "' + tag + '" YAML type.');
    }
  }
  module2.exports = Type;
});

// ../../node_modules/js-yaml/lib/schema.js
var require_schema = __commonJS(function(exports2, module2) {
  var YAMLException = require_exception();
  var Type = require_type();
  function compileList(schema, name) {
    var result = [];
    schema[name].forEach(function(currentType) {
      var newIndex = result.length;
      result.forEach(function(previousType, previousIndex) {
        if (previousType.tag === currentType.tag && previousType.kind === currentType.kind && previousType.multi === currentType.multi) {
          newIndex = previousIndex;
        }
      });
      result[newIndex] = currentType;
    });
    return result;
  }
  function compileMap() {
    var result = {
      scalar: {},
      sequence: {},
      mapping: {},
      fallback: {},
      multi: {
        scalar: [],
        sequence: [],
        mapping: [],
        fallback: []
      }
    }, index, length;
    function collectType(type) {
      if (type.multi) {
        result.multi[type.kind].push(type);
        result.multi["fallback"].push(type);
      } else {
        result[type.kind][type.tag] = result["fallback"][type.tag] = type;
      }
    }
    for (index = 0, length = arguments.length;index < length; index += 1) {
      arguments[index].forEach(collectType);
    }
    return result;
  }
  function Schema(definition) {
    return this.extend(definition);
  }
  Schema.prototype.extend = function extend(definition) {
    var implicit = [];
    var explicit = [];
    if (definition instanceof Type) {
      explicit.push(definition);
    } else if (Array.isArray(definition)) {
      explicit = explicit.concat(definition);
    } else if (definition && (Array.isArray(definition.implicit) || Array.isArray(definition.explicit))) {
      if (definition.implicit)
        implicit = implicit.concat(definition.implicit);
      if (definition.explicit)
        explicit = explicit.concat(definition.explicit);
    } else {
      throw new YAMLException("Schema.extend argument should be a Type, [ Type ], " + "or a schema definition ({ implicit: [...], explicit: [...] })");
    }
    implicit.forEach(function(type) {
      if (!(type instanceof Type)) {
        throw new YAMLException("Specified list of YAML types (or a single Type object) contains a non-Type object.");
      }
      if (type.loadKind && type.loadKind !== "scalar") {
        throw new YAMLException("There is a non-scalar type in the implicit list of a schema. Implicit resolving of such types is not supported.");
      }
      if (type.multi) {
        throw new YAMLException("There is a multi type in the implicit list of a schema. Multi tags can only be listed as explicit.");
      }
    });
    explicit.forEach(function(type) {
      if (!(type instanceof Type)) {
        throw new YAMLException("Specified list of YAML types (or a single Type object) contains a non-Type object.");
      }
    });
    var result = Object.create(Schema.prototype);
    result.implicit = (this.implicit || []).concat(implicit);
    result.explicit = (this.explicit || []).concat(explicit);
    result.compiledImplicit = compileList(result, "implicit");
    result.compiledExplicit = compileList(result, "explicit");
    result.compiledTypeMap = compileMap(result.compiledImplicit, result.compiledExplicit);
    return result;
  };
  module2.exports = Schema;
});

// ../../node_modules/js-yaml/lib/type/str.js
var require_str = __commonJS(function(exports2, module2) {
  var Type = require_type();
  module2.exports = new Type("tag:yaml.org,2002:str", {
    kind: "scalar",
    construct: function(data) {
      return data !== null ? data : "";
    }
  });
});

// ../../node_modules/js-yaml/lib/type/seq.js
var require_seq = __commonJS(function(exports2, module2) {
  var Type = require_type();
  module2.exports = new Type("tag:yaml.org,2002:seq", {
    kind: "sequence",
    construct: function(data) {
      return data !== null ? data : [];
    }
  });
});

// ../../node_modules/js-yaml/lib/type/map.js
var require_map = __commonJS(function(exports2, module2) {
  var Type = require_type();
  module2.exports = new Type("tag:yaml.org,2002:map", {
    kind: "mapping",
    construct: function(data) {
      return data !== null ? data : {};
    }
  });
});

// ../../node_modules/js-yaml/lib/schema/failsafe.js
var require_failsafe = __commonJS(function(exports2, module2) {
  var Schema = require_schema();
  module2.exports = new Schema({
    explicit: [
      require_str(),
      require_seq(),
      require_map()
    ]
  });
});

// ../../node_modules/js-yaml/lib/type/null.js
var require_null = __commonJS(function(exports2, module2) {
  var Type = require_type();
  function resolveYamlNull(data) {
    if (data === null)
      return true;
    var max = data.length;
    return max === 1 && data === "~" || max === 4 && (data === "null" || data === "Null" || data === "NULL");
  }
  function constructYamlNull() {
    return null;
  }
  function isNull(object) {
    return object === null;
  }
  module2.exports = new Type("tag:yaml.org,2002:null", {
    kind: "scalar",
    resolve: resolveYamlNull,
    construct: constructYamlNull,
    predicate: isNull,
    represent: {
      canonical: function() {
        return "~";
      },
      lowercase: function() {
        return "null";
      },
      uppercase: function() {
        return "NULL";
      },
      camelcase: function() {
        return "Null";
      },
      empty: function() {
        return "";
      }
    },
    defaultStyle: "lowercase"
  });
});

// ../../node_modules/js-yaml/lib/type/bool.js
var require_bool = __commonJS(function(exports2, module2) {
  var Type = require_type();
  function resolveYamlBoolean(data) {
    if (data === null)
      return false;
    var max = data.length;
    return max === 4 && (data === "true" || data === "True" || data === "TRUE") || max === 5 && (data === "false" || data === "False" || data === "FALSE");
  }
  function constructYamlBoolean(data) {
    return data === "true" || data === "True" || data === "TRUE";
  }
  function isBoolean(object) {
    return Object.prototype.toString.call(object) === "[object Boolean]";
  }
  module2.exports = new Type("tag:yaml.org,2002:bool", {
    kind: "scalar",
    resolve: resolveYamlBoolean,
    construct: constructYamlBoolean,
    predicate: isBoolean,
    represent: {
      lowercase: function(object) {
        return object ? "true" : "false";
      },
      uppercase: function(object) {
        return object ? "TRUE" : "FALSE";
      },
      camelcase: function(object) {
        return object ? "True" : "False";
      }
    },
    defaultStyle: "lowercase"
  });
});

// ../../node_modules/js-yaml/lib/type/int.js
var require_int = __commonJS(function(exports2, module2) {
  var common = require_common();
  var Type = require_type();
  function isHexCode(c) {
    return 48 <= c && c <= 57 || 65 <= c && c <= 70 || 97 <= c && c <= 102;
  }
  function isOctCode(c) {
    return 48 <= c && c <= 55;
  }
  function isDecCode(c) {
    return 48 <= c && c <= 57;
  }
  function resolveYamlInteger(data) {
    if (data === null)
      return false;
    var max = data.length, index = 0, hasDigits = false, ch;
    if (!max)
      return false;
    ch = data[index];
    if (ch === "-" || ch === "+") {
      ch = data[++index];
    }
    if (ch === "0") {
      if (index + 1 === max)
        return true;
      ch = data[++index];
      if (ch === "b") {
        index++;
        for (;index < max; index++) {
          ch = data[index];
          if (ch === "_")
            continue;
          if (ch !== "0" && ch !== "1")
            return false;
          hasDigits = true;
        }
        return hasDigits && ch !== "_";
      }
      if (ch === "x") {
        index++;
        for (;index < max; index++) {
          ch = data[index];
          if (ch === "_")
            continue;
          if (!isHexCode(data.charCodeAt(index)))
            return false;
          hasDigits = true;
        }
        return hasDigits && ch !== "_";
      }
      if (ch === "o") {
        index++;
        for (;index < max; index++) {
          ch = data[index];
          if (ch === "_")
            continue;
          if (!isOctCode(data.charCodeAt(index)))
            return false;
          hasDigits = true;
        }
        return hasDigits && ch !== "_";
      }
    }
    if (ch === "_")
      return false;
    for (;index < max; index++) {
      ch = data[index];
      if (ch === "_")
        continue;
      if (!isDecCode(data.charCodeAt(index))) {
        return false;
      }
      hasDigits = true;
    }
    if (!hasDigits || ch === "_")
      return false;
    return true;
  }
  function constructYamlInteger(data) {
    var value = data, sign = 1, ch;
    if (value.indexOf("_") !== -1) {
      value = value.replace(/_/g, "");
    }
    ch = value[0];
    if (ch === "-" || ch === "+") {
      if (ch === "-")
        sign = -1;
      value = value.slice(1);
      ch = value[0];
    }
    if (value === "0")
      return 0;
    if (ch === "0") {
      if (value[1] === "b")
        return sign * parseInt(value.slice(2), 2);
      if (value[1] === "x")
        return sign * parseInt(value.slice(2), 16);
      if (value[1] === "o")
        return sign * parseInt(value.slice(2), 8);
    }
    return sign * parseInt(value, 10);
  }
  function isInteger(object) {
    return Object.prototype.toString.call(object) === "[object Number]" && (object % 1 === 0 && !common.isNegativeZero(object));
  }
  module2.exports = new Type("tag:yaml.org,2002:int", {
    kind: "scalar",
    resolve: resolveYamlInteger,
    construct: constructYamlInteger,
    predicate: isInteger,
    represent: {
      binary: function(obj) {
        return obj >= 0 ? "0b" + obj.toString(2) : "-0b" + obj.toString(2).slice(1);
      },
      octal: function(obj) {
        return obj >= 0 ? "0o" + obj.toString(8) : "-0o" + obj.toString(8).slice(1);
      },
      decimal: function(obj) {
        return obj.toString(10);
      },
      hexadecimal: function(obj) {
        return obj >= 0 ? "0x" + obj.toString(16).toUpperCase() : "-0x" + obj.toString(16).toUpperCase().slice(1);
      }
    },
    defaultStyle: "decimal",
    styleAliases: {
      binary: [2, "bin"],
      octal: [8, "oct"],
      decimal: [10, "dec"],
      hexadecimal: [16, "hex"]
    }
  });
});

// ../../node_modules/js-yaml/lib/type/float.js
var require_float = __commonJS(function(exports2, module2) {
  var common = require_common();
  var Type = require_type();
  var YAML_FLOAT_PATTERN = new RegExp("^(?:[-+]?(?:[0-9][0-9_]*)(?:\\.[0-9_]*)?(?:[eE][-+]?[0-9]+)?" + "|\\.[0-9_]+(?:[eE][-+]?[0-9]+)?" + "|[-+]?\\.(?:inf|Inf|INF)" + "|\\.(?:nan|NaN|NAN))$");
  function resolveYamlFloat(data) {
    if (data === null)
      return false;
    if (!YAML_FLOAT_PATTERN.test(data) || data[data.length - 1] === "_") {
      return false;
    }
    return true;
  }
  function constructYamlFloat(data) {
    var value, sign;
    value = data.replace(/_/g, "").toLowerCase();
    sign = value[0] === "-" ? -1 : 1;
    if ("+-".indexOf(value[0]) >= 0) {
      value = value.slice(1);
    }
    if (value === ".inf") {
      return sign === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
    } else if (value === ".nan") {
      return NaN;
    }
    return sign * parseFloat(value, 10);
  }
  var SCIENTIFIC_WITHOUT_DOT = /^[-+]?[0-9]+e/;
  function representYamlFloat(object, style) {
    var res;
    if (isNaN(object)) {
      switch (style) {
        case "lowercase":
          return ".nan";
        case "uppercase":
          return ".NAN";
        case "camelcase":
          return ".NaN";
      }
    } else if (Number.POSITIVE_INFINITY === object) {
      switch (style) {
        case "lowercase":
          return ".inf";
        case "uppercase":
          return ".INF";
        case "camelcase":
          return ".Inf";
      }
    } else if (Number.NEGATIVE_INFINITY === object) {
      switch (style) {
        case "lowercase":
          return "-.inf";
        case "uppercase":
          return "-.INF";
        case "camelcase":
          return "-.Inf";
      }
    } else if (common.isNegativeZero(object)) {
      return "-0.0";
    }
    res = object.toString(10);
    return SCIENTIFIC_WITHOUT_DOT.test(res) ? res.replace("e", ".e") : res;
  }
  function isFloat(object) {
    return Object.prototype.toString.call(object) === "[object Number]" && (object % 1 !== 0 || common.isNegativeZero(object));
  }
  module2.exports = new Type("tag:yaml.org,2002:float", {
    kind: "scalar",
    resolve: resolveYamlFloat,
    construct: constructYamlFloat,
    predicate: isFloat,
    represent: representYamlFloat,
    defaultStyle: "lowercase"
  });
});

// ../../node_modules/js-yaml/lib/schema/json.js
var require_json = __commonJS(function(exports2, module2) {
  module2.exports = require_failsafe().extend({
    implicit: [
      require_null(),
      require_bool(),
      require_int(),
      require_float()
    ]
  });
});

// ../../node_modules/js-yaml/lib/schema/core.js
var require_core = __commonJS(function(exports2, module2) {
  module2.exports = require_json();
});

// ../../node_modules/js-yaml/lib/type/timestamp.js
var require_timestamp = __commonJS(function(exports2, module2) {
  var Type = require_type();
  var YAML_DATE_REGEXP = new RegExp("^([0-9][0-9][0-9][0-9])" + "-([0-9][0-9])" + "-([0-9][0-9])$");
  var YAML_TIMESTAMP_REGEXP = new RegExp("^([0-9][0-9][0-9][0-9])" + "-([0-9][0-9]?)" + "-([0-9][0-9]?)" + "(?:[Tt]|[ \\t]+)" + "([0-9][0-9]?)" + ":([0-9][0-9])" + ":([0-9][0-9])" + "(?:\\.([0-9]*))?" + "(?:[ \\t]*(Z|([-+])([0-9][0-9]?)" + "(?::([0-9][0-9]))?))?$");
  function resolveYamlTimestamp(data) {
    if (data === null)
      return false;
    if (YAML_DATE_REGEXP.exec(data) !== null)
      return true;
    if (YAML_TIMESTAMP_REGEXP.exec(data) !== null)
      return true;
    return false;
  }
  function constructYamlTimestamp(data) {
    var match, year, month, day, hour, minute, second, fraction = 0, delta = null, tz_hour, tz_minute, date;
    match = YAML_DATE_REGEXP.exec(data);
    if (match === null)
      match = YAML_TIMESTAMP_REGEXP.exec(data);
    if (match === null)
      throw new Error("Date resolve error");
    year = +match[1];
    month = +match[2] - 1;
    day = +match[3];
    if (!match[4]) {
      return new Date(Date.UTC(year, month, day));
    }
    hour = +match[4];
    minute = +match[5];
    second = +match[6];
    if (match[7]) {
      fraction = match[7].slice(0, 3);
      while (fraction.length < 3) {
        fraction += "0";
      }
      fraction = +fraction;
    }
    if (match[9]) {
      tz_hour = +match[10];
      tz_minute = +(match[11] || 0);
      delta = (tz_hour * 60 + tz_minute) * 60000;
      if (match[9] === "-")
        delta = -delta;
    }
    date = new Date(Date.UTC(year, month, day, hour, minute, second, fraction));
    if (delta)
      date.setTime(date.getTime() - delta);
    return date;
  }
  function representYamlTimestamp(object) {
    return object.toISOString();
  }
  module2.exports = new Type("tag:yaml.org,2002:timestamp", {
    kind: "scalar",
    resolve: resolveYamlTimestamp,
    construct: constructYamlTimestamp,
    instanceOf: Date,
    represent: representYamlTimestamp
  });
});

// ../../node_modules/js-yaml/lib/type/merge.js
var require_merge = __commonJS(function(exports2, module2) {
  var Type = require_type();
  function resolveYamlMerge(data) {
    return data === "<<" || data === null;
  }
  module2.exports = new Type("tag:yaml.org,2002:merge", {
    kind: "scalar",
    resolve: resolveYamlMerge
  });
});

// ../../node_modules/js-yaml/lib/type/binary.js
var require_binary = __commonJS(function(exports2, module2) {
  var Type = require_type();
  var BASE64_MAP = `ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=
\r`;
  function resolveYamlBinary(data) {
    if (data === null)
      return false;
    var code, idx, bitlen = 0, max = data.length, map = BASE64_MAP;
    for (idx = 0;idx < max; idx++) {
      code = map.indexOf(data.charAt(idx));
      if (code > 64)
        continue;
      if (code < 0)
        return false;
      bitlen += 6;
    }
    return bitlen % 8 === 0;
  }
  function constructYamlBinary(data) {
    var idx, tailbits, input = data.replace(/[\r\n=]/g, ""), max = input.length, map = BASE64_MAP, bits = 0, result = [];
    for (idx = 0;idx < max; idx++) {
      if (idx % 4 === 0 && idx) {
        result.push(bits >> 16 & 255);
        result.push(bits >> 8 & 255);
        result.push(bits & 255);
      }
      bits = bits << 6 | map.indexOf(input.charAt(idx));
    }
    tailbits = max % 4 * 6;
    if (tailbits === 0) {
      result.push(bits >> 16 & 255);
      result.push(bits >> 8 & 255);
      result.push(bits & 255);
    } else if (tailbits === 18) {
      result.push(bits >> 10 & 255);
      result.push(bits >> 2 & 255);
    } else if (tailbits === 12) {
      result.push(bits >> 4 & 255);
    }
    return new Uint8Array(result);
  }
  function representYamlBinary(object) {
    var result = "", bits = 0, idx, tail, max = object.length, map = BASE64_MAP;
    for (idx = 0;idx < max; idx++) {
      if (idx % 3 === 0 && idx) {
        result += map[bits >> 18 & 63];
        result += map[bits >> 12 & 63];
        result += map[bits >> 6 & 63];
        result += map[bits & 63];
      }
      bits = (bits << 8) + object[idx];
    }
    tail = max % 3;
    if (tail === 0) {
      result += map[bits >> 18 & 63];
      result += map[bits >> 12 & 63];
      result += map[bits >> 6 & 63];
      result += map[bits & 63];
    } else if (tail === 2) {
      result += map[bits >> 10 & 63];
      result += map[bits >> 4 & 63];
      result += map[bits << 2 & 63];
      result += map[64];
    } else if (tail === 1) {
      result += map[bits >> 2 & 63];
      result += map[bits << 4 & 63];
      result += map[64];
      result += map[64];
    }
    return result;
  }
  function isBinary(obj) {
    return Object.prototype.toString.call(obj) === "[object Uint8Array]";
  }
  module2.exports = new Type("tag:yaml.org,2002:binary", {
    kind: "scalar",
    resolve: resolveYamlBinary,
    construct: constructYamlBinary,
    predicate: isBinary,
    represent: representYamlBinary
  });
});

// ../../node_modules/js-yaml/lib/type/omap.js
var require_omap = __commonJS(function(exports2, module2) {
  var Type = require_type();
  var _hasOwnProperty = Object.prototype.hasOwnProperty;
  var _toString = Object.prototype.toString;
  function resolveYamlOmap(data) {
    if (data === null)
      return true;
    var objectKeys = [], index, length, pair, pairKey, pairHasKey, object = data;
    for (index = 0, length = object.length;index < length; index += 1) {
      pair = object[index];
      pairHasKey = false;
      if (_toString.call(pair) !== "[object Object]")
        return false;
      for (pairKey in pair) {
        if (_hasOwnProperty.call(pair, pairKey)) {
          if (!pairHasKey)
            pairHasKey = true;
          else
            return false;
        }
      }
      if (!pairHasKey)
        return false;
      if (objectKeys.indexOf(pairKey) === -1)
        objectKeys.push(pairKey);
      else
        return false;
    }
    return true;
  }
  function constructYamlOmap(data) {
    return data !== null ? data : [];
  }
  module2.exports = new Type("tag:yaml.org,2002:omap", {
    kind: "sequence",
    resolve: resolveYamlOmap,
    construct: constructYamlOmap
  });
});

// ../../node_modules/js-yaml/lib/type/pairs.js
var require_pairs = __commonJS(function(exports2, module2) {
  var Type = require_type();
  var _toString = Object.prototype.toString;
  function resolveYamlPairs(data) {
    if (data === null)
      return true;
    var index, length, pair, keys, result, object = data;
    result = new Array(object.length);
    for (index = 0, length = object.length;index < length; index += 1) {
      pair = object[index];
      if (_toString.call(pair) !== "[object Object]")
        return false;
      keys = Object.keys(pair);
      if (keys.length !== 1)
        return false;
      result[index] = [keys[0], pair[keys[0]]];
    }
    return true;
  }
  function constructYamlPairs(data) {
    if (data === null)
      return [];
    var index, length, pair, keys, result, object = data;
    result = new Array(object.length);
    for (index = 0, length = object.length;index < length; index += 1) {
      pair = object[index];
      keys = Object.keys(pair);
      result[index] = [keys[0], pair[keys[0]]];
    }
    return result;
  }
  module2.exports = new Type("tag:yaml.org,2002:pairs", {
    kind: "sequence",
    resolve: resolveYamlPairs,
    construct: constructYamlPairs
  });
});

// ../../node_modules/js-yaml/lib/type/set.js
var require_set = __commonJS(function(exports2, module2) {
  var Type = require_type();
  var _hasOwnProperty = Object.prototype.hasOwnProperty;
  function resolveYamlSet(data) {
    if (data === null)
      return true;
    var key, object = data;
    for (key in object) {
      if (_hasOwnProperty.call(object, key)) {
        if (object[key] !== null)
          return false;
      }
    }
    return true;
  }
  function constructYamlSet(data) {
    return data !== null ? data : {};
  }
  module2.exports = new Type("tag:yaml.org,2002:set", {
    kind: "mapping",
    resolve: resolveYamlSet,
    construct: constructYamlSet
  });
});

// ../../node_modules/js-yaml/lib/schema/default.js
var require_default = __commonJS(function(exports2, module2) {
  module2.exports = require_core().extend({
    implicit: [
      require_timestamp(),
      require_merge()
    ],
    explicit: [
      require_binary(),
      require_omap(),
      require_pairs(),
      require_set()
    ]
  });
});

// ../../node_modules/js-yaml/lib/loader.js
var require_loader = __commonJS(function(exports2, module2) {
  var common = require_common();
  var YAMLException = require_exception();
  var makeSnippet = require_snippet();
  var DEFAULT_SCHEMA = require_default();
  var _hasOwnProperty = Object.prototype.hasOwnProperty;
  var CONTEXT_FLOW_IN = 1;
  var CONTEXT_FLOW_OUT = 2;
  var CONTEXT_BLOCK_IN = 3;
  var CONTEXT_BLOCK_OUT = 4;
  var CHOMPING_CLIP = 1;
  var CHOMPING_STRIP = 2;
  var CHOMPING_KEEP = 3;
  var PATTERN_NON_PRINTABLE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x84\x86-\x9F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/;
  var PATTERN_NON_ASCII_LINE_BREAKS = /[\x85\u2028\u2029]/;
  var PATTERN_FLOW_INDICATORS = /[,\[\]\{\}]/;
  var PATTERN_TAG_HANDLE = /^(?:!|!!|![a-z\-]+!)$/i;
  var PATTERN_TAG_URI = /^(?:!|[^,\[\]\{\}])(?:%[0-9a-f]{2}|[0-9a-z\-#;\/\?:@&=\+\$,_\.!~\*'\(\)\[\]])*$/i;
  function _class(obj) {
    return Object.prototype.toString.call(obj);
  }
  function is_EOL(c) {
    return c === 10 || c === 13;
  }
  function is_WHITE_SPACE(c) {
    return c === 9 || c === 32;
  }
  function is_WS_OR_EOL(c) {
    return c === 9 || c === 32 || c === 10 || c === 13;
  }
  function is_FLOW_INDICATOR(c) {
    return c === 44 || c === 91 || c === 93 || c === 123 || c === 125;
  }
  function fromHexCode(c) {
    var lc;
    if (48 <= c && c <= 57) {
      return c - 48;
    }
    lc = c | 32;
    if (97 <= lc && lc <= 102) {
      return lc - 97 + 10;
    }
    return -1;
  }
  function escapedHexLen(c) {
    if (c === 120) {
      return 2;
    }
    if (c === 117) {
      return 4;
    }
    if (c === 85) {
      return 8;
    }
    return 0;
  }
  function fromDecimalCode(c) {
    if (48 <= c && c <= 57) {
      return c - 48;
    }
    return -1;
  }
  function simpleEscapeSequence(c) {
    return c === 48 ? "\x00" : c === 97 ? "\x07" : c === 98 ? "\b" : c === 116 ? "\t" : c === 9 ? "\t" : c === 110 ? `
` : c === 118 ? "\v" : c === 102 ? "\f" : c === 114 ? "\r" : c === 101 ? "\x1B" : c === 32 ? " " : c === 34 ? '"' : c === 47 ? "/" : c === 92 ? "\\" : c === 78 ? "" : c === 95 ? " " : c === 76 ? "\u2028" : c === 80 ? "\u2029" : "";
  }
  function charFromCodepoint(c) {
    if (c <= 65535) {
      return String.fromCharCode(c);
    }
    return String.fromCharCode((c - 65536 >> 10) + 55296, (c - 65536 & 1023) + 56320);
  }
  function setProperty(object, key, value) {
    if (key === "__proto__") {
      Object.defineProperty(object, key, {
        configurable: true,
        enumerable: true,
        writable: true,
        value
      });
    } else {
      object[key] = value;
    }
  }
  var simpleEscapeCheck = new Array(256);
  var simpleEscapeMap = new Array(256);
  for (i = 0;i < 256; i++) {
    simpleEscapeCheck[i] = simpleEscapeSequence(i) ? 1 : 0;
    simpleEscapeMap[i] = simpleEscapeSequence(i);
  }
  var i;
  function State(input, options) {
    this.input = input;
    this.filename = options["filename"] || null;
    this.schema = options["schema"] || DEFAULT_SCHEMA;
    this.onWarning = options["onWarning"] || null;
    this.legacy = options["legacy"] || false;
    this.json = options["json"] || false;
    this.listener = options["listener"] || null;
    this.implicitTypes = this.schema.compiledImplicit;
    this.typeMap = this.schema.compiledTypeMap;
    this.length = input.length;
    this.position = 0;
    this.line = 0;
    this.lineStart = 0;
    this.lineIndent = 0;
    this.firstTabInLine = -1;
    this.documents = [];
  }
  function generateError(state, message) {
    var mark = {
      name: state.filename,
      buffer: state.input.slice(0, -1),
      position: state.position,
      line: state.line,
      column: state.position - state.lineStart
    };
    mark.snippet = makeSnippet(mark);
    return new YAMLException(message, mark);
  }
  function throwError(state, message) {
    throw generateError(state, message);
  }
  function throwWarning(state, message) {
    if (state.onWarning) {
      state.onWarning.call(null, generateError(state, message));
    }
  }
  var directiveHandlers = {
    YAML: function handleYamlDirective(state, name, args) {
      var match, major, minor;
      if (state.version !== null) {
        throwError(state, "duplication of %YAML directive");
      }
      if (args.length !== 1) {
        throwError(state, "YAML directive accepts exactly one argument");
      }
      match = /^([0-9]+)\.([0-9]+)$/.exec(args[0]);
      if (match === null) {
        throwError(state, "ill-formed argument of the YAML directive");
      }
      major = parseInt(match[1], 10);
      minor = parseInt(match[2], 10);
      if (major !== 1) {
        throwError(state, "unacceptable YAML version of the document");
      }
      state.version = args[0];
      state.checkLineBreaks = minor < 2;
      if (minor !== 1 && minor !== 2) {
        throwWarning(state, "unsupported YAML version of the document");
      }
    },
    TAG: function handleTagDirective(state, name, args) {
      var handle, prefix;
      if (args.length !== 2) {
        throwError(state, "TAG directive accepts exactly two arguments");
      }
      handle = args[0];
      prefix = args[1];
      if (!PATTERN_TAG_HANDLE.test(handle)) {
        throwError(state, "ill-formed tag handle (first argument) of the TAG directive");
      }
      if (_hasOwnProperty.call(state.tagMap, handle)) {
        throwError(state, 'there is a previously declared suffix for "' + handle + '" tag handle');
      }
      if (!PATTERN_TAG_URI.test(prefix)) {
        throwError(state, "ill-formed tag prefix (second argument) of the TAG directive");
      }
      try {
        prefix = decodeURIComponent(prefix);
      } catch (err) {
        throwError(state, "tag prefix is malformed: " + prefix);
      }
      state.tagMap[handle] = prefix;
    }
  };
  function captureSegment(state, start, end, checkJson) {
    var _position, _length, _character, _result;
    if (start < end) {
      _result = state.input.slice(start, end);
      if (checkJson) {
        for (_position = 0, _length = _result.length;_position < _length; _position += 1) {
          _character = _result.charCodeAt(_position);
          if (!(_character === 9 || 32 <= _character && _character <= 1114111)) {
            throwError(state, "expected valid JSON character");
          }
        }
      } else if (PATTERN_NON_PRINTABLE.test(_result)) {
        throwError(state, "the stream contains non-printable characters");
      }
      state.result += _result;
    }
  }
  function mergeMappings(state, destination, source, overridableKeys) {
    var sourceKeys, key, index, quantity;
    if (!common.isObject(source)) {
      throwError(state, "cannot merge mappings; the provided source object is unacceptable");
    }
    sourceKeys = Object.keys(source);
    for (index = 0, quantity = sourceKeys.length;index < quantity; index += 1) {
      key = sourceKeys[index];
      if (!_hasOwnProperty.call(destination, key)) {
        setProperty(destination, key, source[key]);
        overridableKeys[key] = true;
      }
    }
  }
  function storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, startLine, startLineStart, startPos) {
    var index, quantity;
    if (Array.isArray(keyNode)) {
      keyNode = Array.prototype.slice.call(keyNode);
      for (index = 0, quantity = keyNode.length;index < quantity; index += 1) {
        if (Array.isArray(keyNode[index])) {
          throwError(state, "nested arrays are not supported inside keys");
        }
        if (typeof keyNode === "object" && _class(keyNode[index]) === "[object Object]") {
          keyNode[index] = "[object Object]";
        }
      }
    }
    if (typeof keyNode === "object" && _class(keyNode) === "[object Object]") {
      keyNode = "[object Object]";
    }
    keyNode = String(keyNode);
    if (_result === null) {
      _result = {};
    }
    if (keyTag === "tag:yaml.org,2002:merge") {
      if (Array.isArray(valueNode)) {
        for (index = 0, quantity = valueNode.length;index < quantity; index += 1) {
          mergeMappings(state, _result, valueNode[index], overridableKeys);
        }
      } else {
        mergeMappings(state, _result, valueNode, overridableKeys);
      }
    } else {
      if (!state.json && !_hasOwnProperty.call(overridableKeys, keyNode) && _hasOwnProperty.call(_result, keyNode)) {
        state.line = startLine || state.line;
        state.lineStart = startLineStart || state.lineStart;
        state.position = startPos || state.position;
        throwError(state, "duplicated mapping key");
      }
      setProperty(_result, keyNode, valueNode);
      delete overridableKeys[keyNode];
    }
    return _result;
  }
  function readLineBreak(state) {
    var ch;
    ch = state.input.charCodeAt(state.position);
    if (ch === 10) {
      state.position++;
    } else if (ch === 13) {
      state.position++;
      if (state.input.charCodeAt(state.position) === 10) {
        state.position++;
      }
    } else {
      throwError(state, "a line break is expected");
    }
    state.line += 1;
    state.lineStart = state.position;
    state.firstTabInLine = -1;
  }
  function skipSeparationSpace(state, allowComments, checkIndent) {
    var lineBreaks = 0, ch = state.input.charCodeAt(state.position);
    while (ch !== 0) {
      while (is_WHITE_SPACE(ch)) {
        if (ch === 9 && state.firstTabInLine === -1) {
          state.firstTabInLine = state.position;
        }
        ch = state.input.charCodeAt(++state.position);
      }
      if (allowComments && ch === 35) {
        do {
          ch = state.input.charCodeAt(++state.position);
        } while (ch !== 10 && ch !== 13 && ch !== 0);
      }
      if (is_EOL(ch)) {
        readLineBreak(state);
        ch = state.input.charCodeAt(state.position);
        lineBreaks++;
        state.lineIndent = 0;
        while (ch === 32) {
          state.lineIndent++;
          ch = state.input.charCodeAt(++state.position);
        }
      } else {
        break;
      }
    }
    if (checkIndent !== -1 && lineBreaks !== 0 && state.lineIndent < checkIndent) {
      throwWarning(state, "deficient indentation");
    }
    return lineBreaks;
  }
  function testDocumentSeparator(state) {
    var _position = state.position, ch;
    ch = state.input.charCodeAt(_position);
    if ((ch === 45 || ch === 46) && ch === state.input.charCodeAt(_position + 1) && ch === state.input.charCodeAt(_position + 2)) {
      _position += 3;
      ch = state.input.charCodeAt(_position);
      if (ch === 0 || is_WS_OR_EOL(ch)) {
        return true;
      }
    }
    return false;
  }
  function writeFoldedLines(state, count) {
    if (count === 1) {
      state.result += " ";
    } else if (count > 1) {
      state.result += common.repeat(`
`, count - 1);
    }
  }
  function readPlainScalar(state, nodeIndent, withinFlowCollection) {
    var preceding, following, captureStart, captureEnd, hasPendingContent, _line, _lineStart, _lineIndent, { kind: _kind, result: _result } = state, ch;
    ch = state.input.charCodeAt(state.position);
    if (is_WS_OR_EOL(ch) || is_FLOW_INDICATOR(ch) || ch === 35 || ch === 38 || ch === 42 || ch === 33 || ch === 124 || ch === 62 || ch === 39 || ch === 34 || ch === 37 || ch === 64 || ch === 96) {
      return false;
    }
    if (ch === 63 || ch === 45) {
      following = state.input.charCodeAt(state.position + 1);
      if (is_WS_OR_EOL(following) || withinFlowCollection && is_FLOW_INDICATOR(following)) {
        return false;
      }
    }
    state.kind = "scalar";
    state.result = "";
    captureStart = captureEnd = state.position;
    hasPendingContent = false;
    while (ch !== 0) {
      if (ch === 58) {
        following = state.input.charCodeAt(state.position + 1);
        if (is_WS_OR_EOL(following) || withinFlowCollection && is_FLOW_INDICATOR(following)) {
          break;
        }
      } else if (ch === 35) {
        preceding = state.input.charCodeAt(state.position - 1);
        if (is_WS_OR_EOL(preceding)) {
          break;
        }
      } else if (state.position === state.lineStart && testDocumentSeparator(state) || withinFlowCollection && is_FLOW_INDICATOR(ch)) {
        break;
      } else if (is_EOL(ch)) {
        _line = state.line;
        _lineStart = state.lineStart;
        _lineIndent = state.lineIndent;
        skipSeparationSpace(state, false, -1);
        if (state.lineIndent >= nodeIndent) {
          hasPendingContent = true;
          ch = state.input.charCodeAt(state.position);
          continue;
        } else {
          state.position = captureEnd;
          state.line = _line;
          state.lineStart = _lineStart;
          state.lineIndent = _lineIndent;
          break;
        }
      }
      if (hasPendingContent) {
        captureSegment(state, captureStart, captureEnd, false);
        writeFoldedLines(state, state.line - _line);
        captureStart = captureEnd = state.position;
        hasPendingContent = false;
      }
      if (!is_WHITE_SPACE(ch)) {
        captureEnd = state.position + 1;
      }
      ch = state.input.charCodeAt(++state.position);
    }
    captureSegment(state, captureStart, captureEnd, false);
    if (state.result) {
      return true;
    }
    state.kind = _kind;
    state.result = _result;
    return false;
  }
  function readSingleQuotedScalar(state, nodeIndent) {
    var ch, captureStart, captureEnd;
    ch = state.input.charCodeAt(state.position);
    if (ch !== 39) {
      return false;
    }
    state.kind = "scalar";
    state.result = "";
    state.position++;
    captureStart = captureEnd = state.position;
    while ((ch = state.input.charCodeAt(state.position)) !== 0) {
      if (ch === 39) {
        captureSegment(state, captureStart, state.position, true);
        ch = state.input.charCodeAt(++state.position);
        if (ch === 39) {
          captureStart = state.position;
          state.position++;
          captureEnd = state.position;
        } else {
          return true;
        }
      } else if (is_EOL(ch)) {
        captureSegment(state, captureStart, captureEnd, true);
        writeFoldedLines(state, skipSeparationSpace(state, false, nodeIndent));
        captureStart = captureEnd = state.position;
      } else if (state.position === state.lineStart && testDocumentSeparator(state)) {
        throwError(state, "unexpected end of the document within a single quoted scalar");
      } else {
        state.position++;
        captureEnd = state.position;
      }
    }
    throwError(state, "unexpected end of the stream within a single quoted scalar");
  }
  function readDoubleQuotedScalar(state, nodeIndent) {
    var captureStart, captureEnd, hexLength, hexResult, tmp, ch;
    ch = state.input.charCodeAt(state.position);
    if (ch !== 34) {
      return false;
    }
    state.kind = "scalar";
    state.result = "";
    state.position++;
    captureStart = captureEnd = state.position;
    while ((ch = state.input.charCodeAt(state.position)) !== 0) {
      if (ch === 34) {
        captureSegment(state, captureStart, state.position, true);
        state.position++;
        return true;
      } else if (ch === 92) {
        captureSegment(state, captureStart, state.position, true);
        ch = state.input.charCodeAt(++state.position);
        if (is_EOL(ch)) {
          skipSeparationSpace(state, false, nodeIndent);
        } else if (ch < 256 && simpleEscapeCheck[ch]) {
          state.result += simpleEscapeMap[ch];
          state.position++;
        } else if ((tmp = escapedHexLen(ch)) > 0) {
          hexLength = tmp;
          hexResult = 0;
          for (;hexLength > 0; hexLength--) {
            ch = state.input.charCodeAt(++state.position);
            if ((tmp = fromHexCode(ch)) >= 0) {
              hexResult = (hexResult << 4) + tmp;
            } else {
              throwError(state, "expected hexadecimal character");
            }
          }
          state.result += charFromCodepoint(hexResult);
          state.position++;
        } else {
          throwError(state, "unknown escape sequence");
        }
        captureStart = captureEnd = state.position;
      } else if (is_EOL(ch)) {
        captureSegment(state, captureStart, captureEnd, true);
        writeFoldedLines(state, skipSeparationSpace(state, false, nodeIndent));
        captureStart = captureEnd = state.position;
      } else if (state.position === state.lineStart && testDocumentSeparator(state)) {
        throwError(state, "unexpected end of the document within a double quoted scalar");
      } else {
        state.position++;
        captureEnd = state.position;
      }
    }
    throwError(state, "unexpected end of the stream within a double quoted scalar");
  }
  function readFlowCollection(state, nodeIndent) {
    var readNext = true, _line, _lineStart, _pos, _tag = state.tag, _result, _anchor = state.anchor, following, terminator, isPair, isExplicitPair, isMapping, overridableKeys = Object.create(null), keyNode, keyTag, valueNode, ch;
    ch = state.input.charCodeAt(state.position);
    if (ch === 91) {
      terminator = 93;
      isMapping = false;
      _result = [];
    } else if (ch === 123) {
      terminator = 125;
      isMapping = true;
      _result = {};
    } else {
      return false;
    }
    if (state.anchor !== null) {
      state.anchorMap[state.anchor] = _result;
    }
    ch = state.input.charCodeAt(++state.position);
    while (ch !== 0) {
      skipSeparationSpace(state, true, nodeIndent);
      ch = state.input.charCodeAt(state.position);
      if (ch === terminator) {
        state.position++;
        state.tag = _tag;
        state.anchor = _anchor;
        state.kind = isMapping ? "mapping" : "sequence";
        state.result = _result;
        return true;
      } else if (!readNext) {
        throwError(state, "missed comma between flow collection entries");
      } else if (ch === 44) {
        throwError(state, "expected the node content, but found ','");
      }
      keyTag = keyNode = valueNode = null;
      isPair = isExplicitPair = false;
      if (ch === 63) {
        following = state.input.charCodeAt(state.position + 1);
        if (is_WS_OR_EOL(following)) {
          isPair = isExplicitPair = true;
          state.position++;
          skipSeparationSpace(state, true, nodeIndent);
        }
      }
      _line = state.line;
      _lineStart = state.lineStart;
      _pos = state.position;
      composeNode(state, nodeIndent, CONTEXT_FLOW_IN, false, true);
      keyTag = state.tag;
      keyNode = state.result;
      skipSeparationSpace(state, true, nodeIndent);
      ch = state.input.charCodeAt(state.position);
      if ((isExplicitPair || state.line === _line) && ch === 58) {
        isPair = true;
        ch = state.input.charCodeAt(++state.position);
        skipSeparationSpace(state, true, nodeIndent);
        composeNode(state, nodeIndent, CONTEXT_FLOW_IN, false, true);
        valueNode = state.result;
      }
      if (isMapping) {
        storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, _line, _lineStart, _pos);
      } else if (isPair) {
        _result.push(storeMappingPair(state, null, overridableKeys, keyTag, keyNode, valueNode, _line, _lineStart, _pos));
      } else {
        _result.push(keyNode);
      }
      skipSeparationSpace(state, true, nodeIndent);
      ch = state.input.charCodeAt(state.position);
      if (ch === 44) {
        readNext = true;
        ch = state.input.charCodeAt(++state.position);
      } else {
        readNext = false;
      }
    }
    throwError(state, "unexpected end of the stream within a flow collection");
  }
  function readBlockScalar(state, nodeIndent) {
    var captureStart, folding, chomping = CHOMPING_CLIP, didReadContent = false, detectedIndent = false, textIndent = nodeIndent, emptyLines = 0, atMoreIndented = false, tmp, ch;
    ch = state.input.charCodeAt(state.position);
    if (ch === 124) {
      folding = false;
    } else if (ch === 62) {
      folding = true;
    } else {
      return false;
    }
    state.kind = "scalar";
    state.result = "";
    while (ch !== 0) {
      ch = state.input.charCodeAt(++state.position);
      if (ch === 43 || ch === 45) {
        if (CHOMPING_CLIP === chomping) {
          chomping = ch === 43 ? CHOMPING_KEEP : CHOMPING_STRIP;
        } else {
          throwError(state, "repeat of a chomping mode identifier");
        }
      } else if ((tmp = fromDecimalCode(ch)) >= 0) {
        if (tmp === 0) {
          throwError(state, "bad explicit indentation width of a block scalar; it cannot be less than one");
        } else if (!detectedIndent) {
          textIndent = nodeIndent + tmp - 1;
          detectedIndent = true;
        } else {
          throwError(state, "repeat of an indentation width identifier");
        }
      } else {
        break;
      }
    }
    if (is_WHITE_SPACE(ch)) {
      do {
        ch = state.input.charCodeAt(++state.position);
      } while (is_WHITE_SPACE(ch));
      if (ch === 35) {
        do {
          ch = state.input.charCodeAt(++state.position);
        } while (!is_EOL(ch) && ch !== 0);
      }
    }
    while (ch !== 0) {
      readLineBreak(state);
      state.lineIndent = 0;
      ch = state.input.charCodeAt(state.position);
      while ((!detectedIndent || state.lineIndent < textIndent) && ch === 32) {
        state.lineIndent++;
        ch = state.input.charCodeAt(++state.position);
      }
      if (!detectedIndent && state.lineIndent > textIndent) {
        textIndent = state.lineIndent;
      }
      if (is_EOL(ch)) {
        emptyLines++;
        continue;
      }
      if (state.lineIndent < textIndent) {
        if (chomping === CHOMPING_KEEP) {
          state.result += common.repeat(`
`, didReadContent ? 1 + emptyLines : emptyLines);
        } else if (chomping === CHOMPING_CLIP) {
          if (didReadContent) {
            state.result += `
`;
          }
        }
        break;
      }
      if (folding) {
        if (is_WHITE_SPACE(ch)) {
          atMoreIndented = true;
          state.result += common.repeat(`
`, didReadContent ? 1 + emptyLines : emptyLines);
        } else if (atMoreIndented) {
          atMoreIndented = false;
          state.result += common.repeat(`
`, emptyLines + 1);
        } else if (emptyLines === 0) {
          if (didReadContent) {
            state.result += " ";
          }
        } else {
          state.result += common.repeat(`
`, emptyLines);
        }
      } else {
        state.result += common.repeat(`
`, didReadContent ? 1 + emptyLines : emptyLines);
      }
      didReadContent = true;
      detectedIndent = true;
      emptyLines = 0;
      captureStart = state.position;
      while (!is_EOL(ch) && ch !== 0) {
        ch = state.input.charCodeAt(++state.position);
      }
      captureSegment(state, captureStart, state.position, false);
    }
    return true;
  }
  function readBlockSequence(state, nodeIndent) {
    var _line, { tag: _tag, anchor: _anchor } = state, _result = [], following, detected = false, ch;
    if (state.firstTabInLine !== -1)
      return false;
    if (state.anchor !== null) {
      state.anchorMap[state.anchor] = _result;
    }
    ch = state.input.charCodeAt(state.position);
    while (ch !== 0) {
      if (state.firstTabInLine !== -1) {
        state.position = state.firstTabInLine;
        throwError(state, "tab characters must not be used in indentation");
      }
      if (ch !== 45) {
        break;
      }
      following = state.input.charCodeAt(state.position + 1);
      if (!is_WS_OR_EOL(following)) {
        break;
      }
      detected = true;
      state.position++;
      if (skipSeparationSpace(state, true, -1)) {
        if (state.lineIndent <= nodeIndent) {
          _result.push(null);
          ch = state.input.charCodeAt(state.position);
          continue;
        }
      }
      _line = state.line;
      composeNode(state, nodeIndent, CONTEXT_BLOCK_IN, false, true);
      _result.push(state.result);
      skipSeparationSpace(state, true, -1);
      ch = state.input.charCodeAt(state.position);
      if ((state.line === _line || state.lineIndent > nodeIndent) && ch !== 0) {
        throwError(state, "bad indentation of a sequence entry");
      } else if (state.lineIndent < nodeIndent) {
        break;
      }
    }
    if (detected) {
      state.tag = _tag;
      state.anchor = _anchor;
      state.kind = "sequence";
      state.result = _result;
      return true;
    }
    return false;
  }
  function readBlockMapping(state, nodeIndent, flowIndent) {
    var following, allowCompact, _line, _keyLine, _keyLineStart, _keyPos, { tag: _tag, anchor: _anchor } = state, _result = {}, overridableKeys = Object.create(null), keyTag = null, keyNode = null, valueNode = null, atExplicitKey = false, detected = false, ch;
    if (state.firstTabInLine !== -1)
      return false;
    if (state.anchor !== null) {
      state.anchorMap[state.anchor] = _result;
    }
    ch = state.input.charCodeAt(state.position);
    while (ch !== 0) {
      if (!atExplicitKey && state.firstTabInLine !== -1) {
        state.position = state.firstTabInLine;
        throwError(state, "tab characters must not be used in indentation");
      }
      following = state.input.charCodeAt(state.position + 1);
      _line = state.line;
      if ((ch === 63 || ch === 58) && is_WS_OR_EOL(following)) {
        if (ch === 63) {
          if (atExplicitKey) {
            storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
            keyTag = keyNode = valueNode = null;
          }
          detected = true;
          atExplicitKey = true;
          allowCompact = true;
        } else if (atExplicitKey) {
          atExplicitKey = false;
          allowCompact = true;
        } else {
          throwError(state, "incomplete explicit mapping pair; a key node is missed; or followed by a non-tabulated empty line");
        }
        state.position += 1;
        ch = following;
      } else {
        _keyLine = state.line;
        _keyLineStart = state.lineStart;
        _keyPos = state.position;
        if (!composeNode(state, flowIndent, CONTEXT_FLOW_OUT, false, true)) {
          break;
        }
        if (state.line === _line) {
          ch = state.input.charCodeAt(state.position);
          while (is_WHITE_SPACE(ch)) {
            ch = state.input.charCodeAt(++state.position);
          }
          if (ch === 58) {
            ch = state.input.charCodeAt(++state.position);
            if (!is_WS_OR_EOL(ch)) {
              throwError(state, "a whitespace character is expected after the key-value separator within a block mapping");
            }
            if (atExplicitKey) {
              storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
              keyTag = keyNode = valueNode = null;
            }
            detected = true;
            atExplicitKey = false;
            allowCompact = false;
            keyTag = state.tag;
            keyNode = state.result;
          } else if (detected) {
            throwError(state, "can not read an implicit mapping pair; a colon is missed");
          } else {
            state.tag = _tag;
            state.anchor = _anchor;
            return true;
          }
        } else if (detected) {
          throwError(state, "can not read a block mapping entry; a multiline key may not be an implicit key");
        } else {
          state.tag = _tag;
          state.anchor = _anchor;
          return true;
        }
      }
      if (state.line === _line || state.lineIndent > nodeIndent) {
        if (atExplicitKey) {
          _keyLine = state.line;
          _keyLineStart = state.lineStart;
          _keyPos = state.position;
        }
        if (composeNode(state, nodeIndent, CONTEXT_BLOCK_OUT, true, allowCompact)) {
          if (atExplicitKey) {
            keyNode = state.result;
          } else {
            valueNode = state.result;
          }
        }
        if (!atExplicitKey) {
          storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, _keyLine, _keyLineStart, _keyPos);
          keyTag = keyNode = valueNode = null;
        }
        skipSeparationSpace(state, true, -1);
        ch = state.input.charCodeAt(state.position);
      }
      if ((state.line === _line || state.lineIndent > nodeIndent) && ch !== 0) {
        throwError(state, "bad indentation of a mapping entry");
      } else if (state.lineIndent < nodeIndent) {
        break;
      }
    }
    if (atExplicitKey) {
      storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
    }
    if (detected) {
      state.tag = _tag;
      state.anchor = _anchor;
      state.kind = "mapping";
      state.result = _result;
    }
    return detected;
  }
  function readTagProperty(state) {
    var _position, isVerbatim = false, isNamed = false, tagHandle, tagName, ch;
    ch = state.input.charCodeAt(state.position);
    if (ch !== 33)
      return false;
    if (state.tag !== null) {
      throwError(state, "duplication of a tag property");
    }
    ch = state.input.charCodeAt(++state.position);
    if (ch === 60) {
      isVerbatim = true;
      ch = state.input.charCodeAt(++state.position);
    } else if (ch === 33) {
      isNamed = true;
      tagHandle = "!!";
      ch = state.input.charCodeAt(++state.position);
    } else {
      tagHandle = "!";
    }
    _position = state.position;
    if (isVerbatim) {
      do {
        ch = state.input.charCodeAt(++state.position);
      } while (ch !== 0 && ch !== 62);
      if (state.position < state.length) {
        tagName = state.input.slice(_position, state.position);
        ch = state.input.charCodeAt(++state.position);
      } else {
        throwError(state, "unexpected end of the stream within a verbatim tag");
      }
    } else {
      while (ch !== 0 && !is_WS_OR_EOL(ch)) {
        if (ch === 33) {
          if (!isNamed) {
            tagHandle = state.input.slice(_position - 1, state.position + 1);
            if (!PATTERN_TAG_HANDLE.test(tagHandle)) {
              throwError(state, "named tag handle cannot contain such characters");
            }
            isNamed = true;
            _position = state.position + 1;
          } else {
            throwError(state, "tag suffix cannot contain exclamation marks");
          }
        }
        ch = state.input.charCodeAt(++state.position);
      }
      tagName = state.input.slice(_position, state.position);
      if (PATTERN_FLOW_INDICATORS.test(tagName)) {
        throwError(state, "tag suffix cannot contain flow indicator characters");
      }
    }
    if (tagName && !PATTERN_TAG_URI.test(tagName)) {
      throwError(state, "tag name cannot contain such characters: " + tagName);
    }
    try {
      tagName = decodeURIComponent(tagName);
    } catch (err) {
      throwError(state, "tag name is malformed: " + tagName);
    }
    if (isVerbatim) {
      state.tag = tagName;
    } else if (_hasOwnProperty.call(state.tagMap, tagHandle)) {
      state.tag = state.tagMap[tagHandle] + tagName;
    } else if (tagHandle === "!") {
      state.tag = "!" + tagName;
    } else if (tagHandle === "!!") {
      state.tag = "tag:yaml.org,2002:" + tagName;
    } else {
      throwError(state, 'undeclared tag handle "' + tagHandle + '"');
    }
    return true;
  }
  function readAnchorProperty(state) {
    var _position, ch;
    ch = state.input.charCodeAt(state.position);
    if (ch !== 38)
      return false;
    if (state.anchor !== null) {
      throwError(state, "duplication of an anchor property");
    }
    ch = state.input.charCodeAt(++state.position);
    _position = state.position;
    while (ch !== 0 && !is_WS_OR_EOL(ch) && !is_FLOW_INDICATOR(ch)) {
      ch = state.input.charCodeAt(++state.position);
    }
    if (state.position === _position) {
      throwError(state, "name of an anchor node must contain at least one character");
    }
    state.anchor = state.input.slice(_position, state.position);
    return true;
  }
  function readAlias(state) {
    var _position, alias, ch;
    ch = state.input.charCodeAt(state.position);
    if (ch !== 42)
      return false;
    ch = state.input.charCodeAt(++state.position);
    _position = state.position;
    while (ch !== 0 && !is_WS_OR_EOL(ch) && !is_FLOW_INDICATOR(ch)) {
      ch = state.input.charCodeAt(++state.position);
    }
    if (state.position === _position) {
      throwError(state, "name of an alias node must contain at least one character");
    }
    alias = state.input.slice(_position, state.position);
    if (!_hasOwnProperty.call(state.anchorMap, alias)) {
      throwError(state, 'unidentified alias "' + alias + '"');
    }
    state.result = state.anchorMap[alias];
    skipSeparationSpace(state, true, -1);
    return true;
  }
  function composeNode(state, parentIndent, nodeContext, allowToSeek, allowCompact) {
    var allowBlockStyles, allowBlockScalars, allowBlockCollections, indentStatus = 1, atNewLine = false, hasContent = false, typeIndex, typeQuantity, typeList, type, flowIndent, blockIndent;
    if (state.listener !== null) {
      state.listener("open", state);
    }
    state.tag = null;
    state.anchor = null;
    state.kind = null;
    state.result = null;
    allowBlockStyles = allowBlockScalars = allowBlockCollections = CONTEXT_BLOCK_OUT === nodeContext || CONTEXT_BLOCK_IN === nodeContext;
    if (allowToSeek) {
      if (skipSeparationSpace(state, true, -1)) {
        atNewLine = true;
        if (state.lineIndent > parentIndent) {
          indentStatus = 1;
        } else if (state.lineIndent === parentIndent) {
          indentStatus = 0;
        } else if (state.lineIndent < parentIndent) {
          indentStatus = -1;
        }
      }
    }
    if (indentStatus === 1) {
      while (readTagProperty(state) || readAnchorProperty(state)) {
        if (skipSeparationSpace(state, true, -1)) {
          atNewLine = true;
          allowBlockCollections = allowBlockStyles;
          if (state.lineIndent > parentIndent) {
            indentStatus = 1;
          } else if (state.lineIndent === parentIndent) {
            indentStatus = 0;
          } else if (state.lineIndent < parentIndent) {
            indentStatus = -1;
          }
        } else {
          allowBlockCollections = false;
        }
      }
    }
    if (allowBlockCollections) {
      allowBlockCollections = atNewLine || allowCompact;
    }
    if (indentStatus === 1 || CONTEXT_BLOCK_OUT === nodeContext) {
      if (CONTEXT_FLOW_IN === nodeContext || CONTEXT_FLOW_OUT === nodeContext) {
        flowIndent = parentIndent;
      } else {
        flowIndent = parentIndent + 1;
      }
      blockIndent = state.position - state.lineStart;
      if (indentStatus === 1) {
        if (allowBlockCollections && (readBlockSequence(state, blockIndent) || readBlockMapping(state, blockIndent, flowIndent)) || readFlowCollection(state, flowIndent)) {
          hasContent = true;
        } else {
          if (allowBlockScalars && readBlockScalar(state, flowIndent) || readSingleQuotedScalar(state, flowIndent) || readDoubleQuotedScalar(state, flowIndent)) {
            hasContent = true;
          } else if (readAlias(state)) {
            hasContent = true;
            if (state.tag !== null || state.anchor !== null) {
              throwError(state, "alias node should not have any properties");
            }
          } else if (readPlainScalar(state, flowIndent, CONTEXT_FLOW_IN === nodeContext)) {
            hasContent = true;
            if (state.tag === null) {
              state.tag = "?";
            }
          }
          if (state.anchor !== null) {
            state.anchorMap[state.anchor] = state.result;
          }
        }
      } else if (indentStatus === 0) {
        hasContent = allowBlockCollections && readBlockSequence(state, blockIndent);
      }
    }
    if (state.tag === null) {
      if (state.anchor !== null) {
        state.anchorMap[state.anchor] = state.result;
      }
    } else if (state.tag === "?") {
      if (state.result !== null && state.kind !== "scalar") {
        throwError(state, 'unacceptable node kind for !<?> tag; it should be "scalar", not "' + state.kind + '"');
      }
      for (typeIndex = 0, typeQuantity = state.implicitTypes.length;typeIndex < typeQuantity; typeIndex += 1) {
        type = state.implicitTypes[typeIndex];
        if (type.resolve(state.result)) {
          state.result = type.construct(state.result);
          state.tag = type.tag;
          if (state.anchor !== null) {
            state.anchorMap[state.anchor] = state.result;
          }
          break;
        }
      }
    } else if (state.tag !== "!") {
      if (_hasOwnProperty.call(state.typeMap[state.kind || "fallback"], state.tag)) {
        type = state.typeMap[state.kind || "fallback"][state.tag];
      } else {
        type = null;
        typeList = state.typeMap.multi[state.kind || "fallback"];
        for (typeIndex = 0, typeQuantity = typeList.length;typeIndex < typeQuantity; typeIndex += 1) {
          if (state.tag.slice(0, typeList[typeIndex].tag.length) === typeList[typeIndex].tag) {
            type = typeList[typeIndex];
            break;
          }
        }
      }
      if (!type) {
        throwError(state, "unknown tag !<" + state.tag + ">");
      }
      if (state.result !== null && type.kind !== state.kind) {
        throwError(state, "unacceptable node kind for !<" + state.tag + '> tag; it should be "' + type.kind + '", not "' + state.kind + '"');
      }
      if (!type.resolve(state.result, state.tag)) {
        throwError(state, "cannot resolve a node with !<" + state.tag + "> explicit tag");
      } else {
        state.result = type.construct(state.result, state.tag);
        if (state.anchor !== null) {
          state.anchorMap[state.anchor] = state.result;
        }
      }
    }
    if (state.listener !== null) {
      state.listener("close", state);
    }
    return state.tag !== null || state.anchor !== null || hasContent;
  }
  function readDocument(state) {
    var documentStart = state.position, _position, directiveName, directiveArgs, hasDirectives = false, ch;
    state.version = null;
    state.checkLineBreaks = state.legacy;
    state.tagMap = Object.create(null);
    state.anchorMap = Object.create(null);
    while ((ch = state.input.charCodeAt(state.position)) !== 0) {
      skipSeparationSpace(state, true, -1);
      ch = state.input.charCodeAt(state.position);
      if (state.lineIndent > 0 || ch !== 37) {
        break;
      }
      hasDirectives = true;
      ch = state.input.charCodeAt(++state.position);
      _position = state.position;
      while (ch !== 0 && !is_WS_OR_EOL(ch)) {
        ch = state.input.charCodeAt(++state.position);
      }
      directiveName = state.input.slice(_position, state.position);
      directiveArgs = [];
      if (directiveName.length < 1) {
        throwError(state, "directive name must not be less than one character in length");
      }
      while (ch !== 0) {
        while (is_WHITE_SPACE(ch)) {
          ch = state.input.charCodeAt(++state.position);
        }
        if (ch === 35) {
          do {
            ch = state.input.charCodeAt(++state.position);
          } while (ch !== 0 && !is_EOL(ch));
          break;
        }
        if (is_EOL(ch))
          break;
        _position = state.position;
        while (ch !== 0 && !is_WS_OR_EOL(ch)) {
          ch = state.input.charCodeAt(++state.position);
        }
        directiveArgs.push(state.input.slice(_position, state.position));
      }
      if (ch !== 0)
        readLineBreak(state);
      if (_hasOwnProperty.call(directiveHandlers, directiveName)) {
        directiveHandlers[directiveName](state, directiveName, directiveArgs);
      } else {
        throwWarning(state, 'unknown document directive "' + directiveName + '"');
      }
    }
    skipSeparationSpace(state, true, -1);
    if (state.lineIndent === 0 && state.input.charCodeAt(state.position) === 45 && state.input.charCodeAt(state.position + 1) === 45 && state.input.charCodeAt(state.position + 2) === 45) {
      state.position += 3;
      skipSeparationSpace(state, true, -1);
    } else if (hasDirectives) {
      throwError(state, "directives end mark is expected");
    }
    composeNode(state, state.lineIndent - 1, CONTEXT_BLOCK_OUT, false, true);
    skipSeparationSpace(state, true, -1);
    if (state.checkLineBreaks && PATTERN_NON_ASCII_LINE_BREAKS.test(state.input.slice(documentStart, state.position))) {
      throwWarning(state, "non-ASCII line breaks are interpreted as content");
    }
    state.documents.push(state.result);
    if (state.position === state.lineStart && testDocumentSeparator(state)) {
      if (state.input.charCodeAt(state.position) === 46) {
        state.position += 3;
        skipSeparationSpace(state, true, -1);
      }
      return;
    }
    if (state.position < state.length - 1) {
      throwError(state, "end of the stream or a document separator is expected");
    } else {
      return;
    }
  }
  function loadDocuments(input, options) {
    input = String(input);
    options = options || {};
    if (input.length !== 0) {
      if (input.charCodeAt(input.length - 1) !== 10 && input.charCodeAt(input.length - 1) !== 13) {
        input += `
`;
      }
      if (input.charCodeAt(0) === 65279) {
        input = input.slice(1);
      }
    }
    var state = new State(input, options);
    var nullpos = input.indexOf("\x00");
    if (nullpos !== -1) {
      state.position = nullpos;
      throwError(state, "null byte is not allowed in input");
    }
    state.input += "\x00";
    while (state.input.charCodeAt(state.position) === 32) {
      state.lineIndent += 1;
      state.position += 1;
    }
    while (state.position < state.length - 1) {
      readDocument(state);
    }
    return state.documents;
  }
  function loadAll(input, iterator, options) {
    if (iterator !== null && typeof iterator === "object" && typeof options === "undefined") {
      options = iterator;
      iterator = null;
    }
    var documents = loadDocuments(input, options);
    if (typeof iterator !== "function") {
      return documents;
    }
    for (var index = 0, length = documents.length;index < length; index += 1) {
      iterator(documents[index]);
    }
  }
  function load(input, options) {
    var documents = loadDocuments(input, options);
    if (documents.length === 0) {
      return;
    } else if (documents.length === 1) {
      return documents[0];
    }
    throw new YAMLException("expected a single document in the stream, but found more");
  }
  module2.exports.loadAll = loadAll;
  module2.exports.load = load;
});

// ../../node_modules/js-yaml/lib/dumper.js
var require_dumper = __commonJS(function(exports2, module2) {
  var common = require_common();
  var YAMLException = require_exception();
  var DEFAULT_SCHEMA = require_default();
  var _toString = Object.prototype.toString;
  var _hasOwnProperty = Object.prototype.hasOwnProperty;
  var CHAR_BOM = 65279;
  var CHAR_TAB = 9;
  var CHAR_LINE_FEED = 10;
  var CHAR_CARRIAGE_RETURN = 13;
  var CHAR_SPACE = 32;
  var CHAR_EXCLAMATION = 33;
  var CHAR_DOUBLE_QUOTE = 34;
  var CHAR_SHARP = 35;
  var CHAR_PERCENT = 37;
  var CHAR_AMPERSAND = 38;
  var CHAR_SINGLE_QUOTE = 39;
  var CHAR_ASTERISK = 42;
  var CHAR_COMMA = 44;
  var CHAR_MINUS = 45;
  var CHAR_COLON = 58;
  var CHAR_EQUALS = 61;
  var CHAR_GREATER_THAN = 62;
  var CHAR_QUESTION = 63;
  var CHAR_COMMERCIAL_AT = 64;
  var CHAR_LEFT_SQUARE_BRACKET = 91;
  var CHAR_RIGHT_SQUARE_BRACKET = 93;
  var CHAR_GRAVE_ACCENT = 96;
  var CHAR_LEFT_CURLY_BRACKET = 123;
  var CHAR_VERTICAL_LINE = 124;
  var CHAR_RIGHT_CURLY_BRACKET = 125;
  var ESCAPE_SEQUENCES = {};
  ESCAPE_SEQUENCES[0] = "\\0";
  ESCAPE_SEQUENCES[7] = "\\a";
  ESCAPE_SEQUENCES[8] = "\\b";
  ESCAPE_SEQUENCES[9] = "\\t";
  ESCAPE_SEQUENCES[10] = "\\n";
  ESCAPE_SEQUENCES[11] = "\\v";
  ESCAPE_SEQUENCES[12] = "\\f";
  ESCAPE_SEQUENCES[13] = "\\r";
  ESCAPE_SEQUENCES[27] = "\\e";
  ESCAPE_SEQUENCES[34] = "\\\"";
  ESCAPE_SEQUENCES[92] = "\\\\";
  ESCAPE_SEQUENCES[133] = "\\N";
  ESCAPE_SEQUENCES[160] = "\\_";
  ESCAPE_SEQUENCES[8232] = "\\L";
  ESCAPE_SEQUENCES[8233] = "\\P";
  var DEPRECATED_BOOLEANS_SYNTAX = [
    "y",
    "Y",
    "yes",
    "Yes",
    "YES",
    "on",
    "On",
    "ON",
    "n",
    "N",
    "no",
    "No",
    "NO",
    "off",
    "Off",
    "OFF"
  ];
  var DEPRECATED_BASE60_SYNTAX = /^[-+]?[0-9_]+(?::[0-9_]+)+(?:\.[0-9_]*)?$/;
  function compileStyleMap(schema, map) {
    var result, keys, index, length, tag, style, type;
    if (map === null)
      return {};
    result = {};
    keys = Object.keys(map);
    for (index = 0, length = keys.length;index < length; index += 1) {
      tag = keys[index];
      style = String(map[tag]);
      if (tag.slice(0, 2) === "!!") {
        tag = "tag:yaml.org,2002:" + tag.slice(2);
      }
      type = schema.compiledTypeMap["fallback"][tag];
      if (type && _hasOwnProperty.call(type.styleAliases, style)) {
        style = type.styleAliases[style];
      }
      result[tag] = style;
    }
    return result;
  }
  function encodeHex(character) {
    var string, handle, length;
    string = character.toString(16).toUpperCase();
    if (character <= 255) {
      handle = "x";
      length = 2;
    } else if (character <= 65535) {
      handle = "u";
      length = 4;
    } else if (character <= 4294967295) {
      handle = "U";
      length = 8;
    } else {
      throw new YAMLException("code point within a string may not be greater than 0xFFFFFFFF");
    }
    return "\\" + handle + common.repeat("0", length - string.length) + string;
  }
  var QUOTING_TYPE_SINGLE = 1;
  var QUOTING_TYPE_DOUBLE = 2;
  function State(options) {
    this.schema = options["schema"] || DEFAULT_SCHEMA;
    this.indent = Math.max(1, options["indent"] || 2);
    this.noArrayIndent = options["noArrayIndent"] || false;
    this.skipInvalid = options["skipInvalid"] || false;
    this.flowLevel = common.isNothing(options["flowLevel"]) ? -1 : options["flowLevel"];
    this.styleMap = compileStyleMap(this.schema, options["styles"] || null);
    this.sortKeys = options["sortKeys"] || false;
    this.lineWidth = options["lineWidth"] || 80;
    this.noRefs = options["noRefs"] || false;
    this.noCompatMode = options["noCompatMode"] || false;
    this.condenseFlow = options["condenseFlow"] || false;
    this.quotingType = options["quotingType"] === '"' ? QUOTING_TYPE_DOUBLE : QUOTING_TYPE_SINGLE;
    this.forceQuotes = options["forceQuotes"] || false;
    this.replacer = typeof options["replacer"] === "function" ? options["replacer"] : null;
    this.implicitTypes = this.schema.compiledImplicit;
    this.explicitTypes = this.schema.compiledExplicit;
    this.tag = null;
    this.result = "";
    this.duplicates = [];
    this.usedDuplicates = null;
  }
  function indentString(string, spaces) {
    var ind = common.repeat(" ", spaces), position = 0, next = -1, result = "", line, length = string.length;
    while (position < length) {
      next = string.indexOf(`
`, position);
      if (next === -1) {
        line = string.slice(position);
        position = length;
      } else {
        line = string.slice(position, next + 1);
        position = next + 1;
      }
      if (line.length && line !== `
`)
        result += ind;
      result += line;
    }
    return result;
  }
  function generateNextLine(state, level) {
    return `
` + common.repeat(" ", state.indent * level);
  }
  function testImplicitResolving(state, str) {
    var index, length, type;
    for (index = 0, length = state.implicitTypes.length;index < length; index += 1) {
      type = state.implicitTypes[index];
      if (type.resolve(str)) {
        return true;
      }
    }
    return false;
  }
  function isWhitespace(c) {
    return c === CHAR_SPACE || c === CHAR_TAB;
  }
  function isPrintable(c) {
    return 32 <= c && c <= 126 || 161 <= c && c <= 55295 && c !== 8232 && c !== 8233 || 57344 <= c && c <= 65533 && c !== CHAR_BOM || 65536 <= c && c <= 1114111;
  }
  function isNsCharOrWhitespace(c) {
    return isPrintable(c) && c !== CHAR_BOM && c !== CHAR_CARRIAGE_RETURN && c !== CHAR_LINE_FEED;
  }
  function isPlainSafe(c, prev, inblock) {
    var cIsNsCharOrWhitespace = isNsCharOrWhitespace(c);
    var cIsNsChar = cIsNsCharOrWhitespace && !isWhitespace(c);
    return (inblock ? cIsNsCharOrWhitespace : cIsNsCharOrWhitespace && c !== CHAR_COMMA && c !== CHAR_LEFT_SQUARE_BRACKET && c !== CHAR_RIGHT_SQUARE_BRACKET && c !== CHAR_LEFT_CURLY_BRACKET && c !== CHAR_RIGHT_CURLY_BRACKET) && c !== CHAR_SHARP && !(prev === CHAR_COLON && !cIsNsChar) || isNsCharOrWhitespace(prev) && !isWhitespace(prev) && c === CHAR_SHARP || prev === CHAR_COLON && cIsNsChar;
  }
  function isPlainSafeFirst(c) {
    return isPrintable(c) && c !== CHAR_BOM && !isWhitespace(c) && c !== CHAR_MINUS && c !== CHAR_QUESTION && c !== CHAR_COLON && c !== CHAR_COMMA && c !== CHAR_LEFT_SQUARE_BRACKET && c !== CHAR_RIGHT_SQUARE_BRACKET && c !== CHAR_LEFT_CURLY_BRACKET && c !== CHAR_RIGHT_CURLY_BRACKET && c !== CHAR_SHARP && c !== CHAR_AMPERSAND && c !== CHAR_ASTERISK && c !== CHAR_EXCLAMATION && c !== CHAR_VERTICAL_LINE && c !== CHAR_EQUALS && c !== CHAR_GREATER_THAN && c !== CHAR_SINGLE_QUOTE && c !== CHAR_DOUBLE_QUOTE && c !== CHAR_PERCENT && c !== CHAR_COMMERCIAL_AT && c !== CHAR_GRAVE_ACCENT;
  }
  function isPlainSafeLast(c) {
    return !isWhitespace(c) && c !== CHAR_COLON;
  }
  function codePointAt(string, pos) {
    var first = string.charCodeAt(pos), second;
    if (first >= 55296 && first <= 56319 && pos + 1 < string.length) {
      second = string.charCodeAt(pos + 1);
      if (second >= 56320 && second <= 57343) {
        return (first - 55296) * 1024 + second - 56320 + 65536;
      }
    }
    return first;
  }
  function needIndentIndicator(string) {
    var leadingSpaceRe = /^\n* /;
    return leadingSpaceRe.test(string);
  }
  var STYLE_PLAIN = 1;
  var STYLE_SINGLE = 2;
  var STYLE_LITERAL = 3;
  var STYLE_FOLDED = 4;
  var STYLE_DOUBLE = 5;
  function chooseScalarStyle(string, singleLineOnly, indentPerLevel, lineWidth, testAmbiguousType, quotingType, forceQuotes, inblock) {
    var i;
    var char = 0;
    var prevChar = null;
    var hasLineBreak = false;
    var hasFoldableLine = false;
    var shouldTrackWidth = lineWidth !== -1;
    var previousLineBreak = -1;
    var plain = isPlainSafeFirst(codePointAt(string, 0)) && isPlainSafeLast(codePointAt(string, string.length - 1));
    if (singleLineOnly || forceQuotes) {
      for (i = 0;i < string.length; char >= 65536 ? i += 2 : i++) {
        char = codePointAt(string, i);
        if (!isPrintable(char)) {
          return STYLE_DOUBLE;
        }
        plain = plain && isPlainSafe(char, prevChar, inblock);
        prevChar = char;
      }
    } else {
      for (i = 0;i < string.length; char >= 65536 ? i += 2 : i++) {
        char = codePointAt(string, i);
        if (char === CHAR_LINE_FEED) {
          hasLineBreak = true;
          if (shouldTrackWidth) {
            hasFoldableLine = hasFoldableLine || i - previousLineBreak - 1 > lineWidth && string[previousLineBreak + 1] !== " ";
            previousLineBreak = i;
          }
        } else if (!isPrintable(char)) {
          return STYLE_DOUBLE;
        }
        plain = plain && isPlainSafe(char, prevChar, inblock);
        prevChar = char;
      }
      hasFoldableLine = hasFoldableLine || shouldTrackWidth && (i - previousLineBreak - 1 > lineWidth && string[previousLineBreak + 1] !== " ");
    }
    if (!hasLineBreak && !hasFoldableLine) {
      if (plain && !forceQuotes && !testAmbiguousType(string)) {
        return STYLE_PLAIN;
      }
      return quotingType === QUOTING_TYPE_DOUBLE ? STYLE_DOUBLE : STYLE_SINGLE;
    }
    if (indentPerLevel > 9 && needIndentIndicator(string)) {
      return STYLE_DOUBLE;
    }
    if (!forceQuotes) {
      return hasFoldableLine ? STYLE_FOLDED : STYLE_LITERAL;
    }
    return quotingType === QUOTING_TYPE_DOUBLE ? STYLE_DOUBLE : STYLE_SINGLE;
  }
  function writeScalar(state, string, level, iskey, inblock) {
    state.dump = function() {
      if (string.length === 0) {
        return state.quotingType === QUOTING_TYPE_DOUBLE ? '""' : "''";
      }
      if (!state.noCompatMode) {
        if (DEPRECATED_BOOLEANS_SYNTAX.indexOf(string) !== -1 || DEPRECATED_BASE60_SYNTAX.test(string)) {
          return state.quotingType === QUOTING_TYPE_DOUBLE ? '"' + string + '"' : "'" + string + "'";
        }
      }
      var indent = state.indent * Math.max(1, level);
      var lineWidth = state.lineWidth === -1 ? -1 : Math.max(Math.min(state.lineWidth, 40), state.lineWidth - indent);
      var singleLineOnly = iskey || state.flowLevel > -1 && level >= state.flowLevel;
      function testAmbiguity(string) {
        return testImplicitResolving(state, string);
      }
      switch (chooseScalarStyle(string, singleLineOnly, state.indent, lineWidth, testAmbiguity, state.quotingType, state.forceQuotes && !iskey, inblock)) {
        case STYLE_PLAIN:
          return string;
        case STYLE_SINGLE:
          return "'" + string.replace(/'/g, "''") + "'";
        case STYLE_LITERAL:
          return "|" + blockHeader(string, state.indent) + dropEndingNewline(indentString(string, indent));
        case STYLE_FOLDED:
          return ">" + blockHeader(string, state.indent) + dropEndingNewline(indentString(foldString(string, lineWidth), indent));
        case STYLE_DOUBLE:
          return '"' + escapeString(string, lineWidth) + '"';
        default:
          throw new YAMLException("impossible error: invalid scalar style");
      }
    }();
  }
  function blockHeader(string, indentPerLevel) {
    var indentIndicator = needIndentIndicator(string) ? String(indentPerLevel) : "";
    var clip = string[string.length - 1] === `
`;
    var keep = clip && (string[string.length - 2] === `
` || string === `
`);
    var chomp = keep ? "+" : clip ? "" : "-";
    return indentIndicator + chomp + `
`;
  }
  function dropEndingNewline(string) {
    return string[string.length - 1] === `
` ? string.slice(0, -1) : string;
  }
  function foldString(string, width) {
    var lineRe = /(\n+)([^\n]*)/g;
    var result = function() {
      var nextLF = string.indexOf(`
`);
      nextLF = nextLF !== -1 ? nextLF : string.length;
      lineRe.lastIndex = nextLF;
      return foldLine(string.slice(0, nextLF), width);
    }();
    var prevMoreIndented = string[0] === `
` || string[0] === " ";
    var moreIndented;
    var match;
    while (match = lineRe.exec(string)) {
      var prefix = match[1], line = match[2];
      moreIndented = line[0] === " ";
      result += prefix + (!prevMoreIndented && !moreIndented && line !== "" ? `
` : "") + foldLine(line, width);
      prevMoreIndented = moreIndented;
    }
    return result;
  }
  function foldLine(line, width) {
    if (line === "" || line[0] === " ")
      return line;
    var breakRe = / [^ ]/g;
    var match;
    var start = 0, end, curr = 0, next = 0;
    var result = "";
    while (match = breakRe.exec(line)) {
      next = match.index;
      if (next - start > width) {
        end = curr > start ? curr : next;
        result += `
` + line.slice(start, end);
        start = end + 1;
      }
      curr = next;
    }
    result += `
`;
    if (line.length - start > width && curr > start) {
      result += line.slice(start, curr) + `
` + line.slice(curr + 1);
    } else {
      result += line.slice(start);
    }
    return result.slice(1);
  }
  function escapeString(string) {
    var result = "";
    var char = 0;
    var escapeSeq;
    for (var i = 0;i < string.length; char >= 65536 ? i += 2 : i++) {
      char = codePointAt(string, i);
      escapeSeq = ESCAPE_SEQUENCES[char];
      if (!escapeSeq && isPrintable(char)) {
        result += string[i];
        if (char >= 65536)
          result += string[i + 1];
      } else {
        result += escapeSeq || encodeHex(char);
      }
    }
    return result;
  }
  function writeFlowSequence(state, level, object) {
    var _result = "", _tag = state.tag, index, length, value;
    for (index = 0, length = object.length;index < length; index += 1) {
      value = object[index];
      if (state.replacer) {
        value = state.replacer.call(object, String(index), value);
      }
      if (writeNode(state, level, value, false, false) || typeof value === "undefined" && writeNode(state, level, null, false, false)) {
        if (_result !== "")
          _result += "," + (!state.condenseFlow ? " " : "");
        _result += state.dump;
      }
    }
    state.tag = _tag;
    state.dump = "[" + _result + "]";
  }
  function writeBlockSequence(state, level, object, compact) {
    var _result = "", _tag = state.tag, index, length, value;
    for (index = 0, length = object.length;index < length; index += 1) {
      value = object[index];
      if (state.replacer) {
        value = state.replacer.call(object, String(index), value);
      }
      if (writeNode(state, level + 1, value, true, true, false, true) || typeof value === "undefined" && writeNode(state, level + 1, null, true, true, false, true)) {
        if (!compact || _result !== "") {
          _result += generateNextLine(state, level);
        }
        if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) {
          _result += "-";
        } else {
          _result += "- ";
        }
        _result += state.dump;
      }
    }
    state.tag = _tag;
    state.dump = _result || "[]";
  }
  function writeFlowMapping(state, level, object) {
    var _result = "", _tag = state.tag, objectKeyList = Object.keys(object), index, length, objectKey, objectValue, pairBuffer;
    for (index = 0, length = objectKeyList.length;index < length; index += 1) {
      pairBuffer = "";
      if (_result !== "")
        pairBuffer += ", ";
      if (state.condenseFlow)
        pairBuffer += '"';
      objectKey = objectKeyList[index];
      objectValue = object[objectKey];
      if (state.replacer) {
        objectValue = state.replacer.call(object, objectKey, objectValue);
      }
      if (!writeNode(state, level, objectKey, false, false)) {
        continue;
      }
      if (state.dump.length > 1024)
        pairBuffer += "? ";
      pairBuffer += state.dump + (state.condenseFlow ? '"' : "") + ":" + (state.condenseFlow ? "" : " ");
      if (!writeNode(state, level, objectValue, false, false)) {
        continue;
      }
      pairBuffer += state.dump;
      _result += pairBuffer;
    }
    state.tag = _tag;
    state.dump = "{" + _result + "}";
  }
  function writeBlockMapping(state, level, object, compact) {
    var _result = "", _tag = state.tag, objectKeyList = Object.keys(object), index, length, objectKey, objectValue, explicitPair, pairBuffer;
    if (state.sortKeys === true) {
      objectKeyList.sort();
    } else if (typeof state.sortKeys === "function") {
      objectKeyList.sort(state.sortKeys);
    } else if (state.sortKeys) {
      throw new YAMLException("sortKeys must be a boolean or a function");
    }
    for (index = 0, length = objectKeyList.length;index < length; index += 1) {
      pairBuffer = "";
      if (!compact || _result !== "") {
        pairBuffer += generateNextLine(state, level);
      }
      objectKey = objectKeyList[index];
      objectValue = object[objectKey];
      if (state.replacer) {
        objectValue = state.replacer.call(object, objectKey, objectValue);
      }
      if (!writeNode(state, level + 1, objectKey, true, true, true)) {
        continue;
      }
      explicitPair = state.tag !== null && state.tag !== "?" || state.dump && state.dump.length > 1024;
      if (explicitPair) {
        if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) {
          pairBuffer += "?";
        } else {
          pairBuffer += "? ";
        }
      }
      pairBuffer += state.dump;
      if (explicitPair) {
        pairBuffer += generateNextLine(state, level);
      }
      if (!writeNode(state, level + 1, objectValue, true, explicitPair)) {
        continue;
      }
      if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) {
        pairBuffer += ":";
      } else {
        pairBuffer += ": ";
      }
      pairBuffer += state.dump;
      _result += pairBuffer;
    }
    state.tag = _tag;
    state.dump = _result || "{}";
  }
  function detectType(state, object, explicit) {
    var _result, typeList, index, length, type, style;
    typeList = explicit ? state.explicitTypes : state.implicitTypes;
    for (index = 0, length = typeList.length;index < length; index += 1) {
      type = typeList[index];
      if ((type.instanceOf || type.predicate) && (!type.instanceOf || typeof object === "object" && object instanceof type.instanceOf) && (!type.predicate || type.predicate(object))) {
        if (explicit) {
          if (type.multi && type.representName) {
            state.tag = type.representName(object);
          } else {
            state.tag = type.tag;
          }
        } else {
          state.tag = "?";
        }
        if (type.represent) {
          style = state.styleMap[type.tag] || type.defaultStyle;
          if (_toString.call(type.represent) === "[object Function]") {
            _result = type.represent(object, style);
          } else if (_hasOwnProperty.call(type.represent, style)) {
            _result = type.represent[style](object, style);
          } else {
            throw new YAMLException("!<" + type.tag + '> tag resolver accepts not "' + style + '" style');
          }
          state.dump = _result;
        }
        return true;
      }
    }
    return false;
  }
  function writeNode(state, level, object, block, compact, iskey, isblockseq) {
    state.tag = null;
    state.dump = object;
    if (!detectType(state, object, false)) {
      detectType(state, object, true);
    }
    var type = _toString.call(state.dump);
    var inblock = block;
    var tagStr;
    if (block) {
      block = state.flowLevel < 0 || state.flowLevel > level;
    }
    var objectOrArray = type === "[object Object]" || type === "[object Array]", duplicateIndex, duplicate;
    if (objectOrArray) {
      duplicateIndex = state.duplicates.indexOf(object);
      duplicate = duplicateIndex !== -1;
    }
    if (state.tag !== null && state.tag !== "?" || duplicate || state.indent !== 2 && level > 0) {
      compact = false;
    }
    if (duplicate && state.usedDuplicates[duplicateIndex]) {
      state.dump = "*ref_" + duplicateIndex;
    } else {
      if (objectOrArray && duplicate && !state.usedDuplicates[duplicateIndex]) {
        state.usedDuplicates[duplicateIndex] = true;
      }
      if (type === "[object Object]") {
        if (block && Object.keys(state.dump).length !== 0) {
          writeBlockMapping(state, level, state.dump, compact);
          if (duplicate) {
            state.dump = "&ref_" + duplicateIndex + state.dump;
          }
        } else {
          writeFlowMapping(state, level, state.dump);
          if (duplicate) {
            state.dump = "&ref_" + duplicateIndex + " " + state.dump;
          }
        }
      } else if (type === "[object Array]") {
        if (block && state.dump.length !== 0) {
          if (state.noArrayIndent && !isblockseq && level > 0) {
            writeBlockSequence(state, level - 1, state.dump, compact);
          } else {
            writeBlockSequence(state, level, state.dump, compact);
          }
          if (duplicate) {
            state.dump = "&ref_" + duplicateIndex + state.dump;
          }
        } else {
          writeFlowSequence(state, level, state.dump);
          if (duplicate) {
            state.dump = "&ref_" + duplicateIndex + " " + state.dump;
          }
        }
      } else if (type === "[object String]") {
        if (state.tag !== "?") {
          writeScalar(state, state.dump, level, iskey, inblock);
        }
      } else if (type === "[object Undefined]") {
        return false;
      } else {
        if (state.skipInvalid)
          return false;
        throw new YAMLException("unacceptable kind of an object to dump " + type);
      }
      if (state.tag !== null && state.tag !== "?") {
        tagStr = encodeURI(state.tag[0] === "!" ? state.tag.slice(1) : state.tag).replace(/!/g, "%21");
        if (state.tag[0] === "!") {
          tagStr = "!" + tagStr;
        } else if (tagStr.slice(0, 18) === "tag:yaml.org,2002:") {
          tagStr = "!!" + tagStr.slice(18);
        } else {
          tagStr = "!<" + tagStr + ">";
        }
        state.dump = tagStr + " " + state.dump;
      }
    }
    return true;
  }
  function getDuplicateReferences(object, state) {
    var objects = [], duplicatesIndexes = [], index, length;
    inspectNode(object, objects, duplicatesIndexes);
    for (index = 0, length = duplicatesIndexes.length;index < length; index += 1) {
      state.duplicates.push(objects[duplicatesIndexes[index]]);
    }
    state.usedDuplicates = new Array(length);
  }
  function inspectNode(object, objects, duplicatesIndexes) {
    var objectKeyList, index, length;
    if (object !== null && typeof object === "object") {
      index = objects.indexOf(object);
      if (index !== -1) {
        if (duplicatesIndexes.indexOf(index) === -1) {
          duplicatesIndexes.push(index);
        }
      } else {
        objects.push(object);
        if (Array.isArray(object)) {
          for (index = 0, length = object.length;index < length; index += 1) {
            inspectNode(object[index], objects, duplicatesIndexes);
          }
        } else {
          objectKeyList = Object.keys(object);
          for (index = 0, length = objectKeyList.length;index < length; index += 1) {
            inspectNode(object[objectKeyList[index]], objects, duplicatesIndexes);
          }
        }
      }
    }
  }
  function dump(input, options) {
    options = options || {};
    var state = new State(options);
    if (!state.noRefs)
      getDuplicateReferences(input, state);
    var value = input;
    if (state.replacer) {
      value = state.replacer.call({ "": value }, "", value);
    }
    if (writeNode(state, 0, value, true, true))
      return state.dump + `
`;
    return "";
  }
  module2.exports.dump = dump;
});

// ../../node_modules/js-yaml/index.js
var require_js_yaml = __commonJS(function(exports2, module2) {
  var loader = require_loader();
  var dumper = require_dumper();
  function renamed(from, to) {
    return function() {
      throw new Error("Function yaml." + from + " is removed in js-yaml 4. " + "Use yaml." + to + " instead, which is now safe by default.");
    };
  }
  module2.exports.Type = require_type();
  module2.exports.Schema = require_schema();
  module2.exports.FAILSAFE_SCHEMA = require_failsafe();
  module2.exports.JSON_SCHEMA = require_json();
  module2.exports.CORE_SCHEMA = require_core();
  module2.exports.DEFAULT_SCHEMA = require_default();
  module2.exports.load = loader.load;
  module2.exports.loadAll = loader.loadAll;
  module2.exports.dump = dumper.dump;
  module2.exports.YAMLException = require_exception();
  module2.exports.types = {
    binary: require_binary(),
    float: require_float(),
    map: require_map(),
    null: require_null(),
    pairs: require_pairs(),
    set: require_set(),
    timestamp: require_timestamp(),
    bool: require_bool(),
    int: require_int(),
    merge: require_merge(),
    omap: require_omap(),
    seq: require_seq(),
    str: require_str()
  };
  module2.exports.safeLoad = renamed("safeLoad", "load");
  module2.exports.safeLoadAll = renamed("safeLoadAll", "loadAll");
  module2.exports.safeDump = renamed("safeDump", "dump");
});

// ../agent-core/dist/type-guards.js
var require_type_guards = __commonJS(function(exports2) {
  Object.defineProperty(exports2, "__esModule", { value: true });
  exports2.isRecord = isRecord;
  function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
});

// ../agent-core/dist/lifecycle-hooks/config.js
var require_config = __commonJS(function(exports2) {
  var __createBinding = exports2 && exports2.__createBinding || (Object.create ? function(o, m, k, k2) {
    if (k2 === undefined)
      k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() {
        return m[k];
      } };
    }
    Object.defineProperty(o, k2, desc);
  } : function(o, m, k, k2) {
    if (k2 === undefined)
      k2 = k;
    o[k2] = m[k];
  });
  var __setModuleDefault = exports2 && exports2.__setModuleDefault || (Object.create ? function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
  } : function(o, v) {
    o["default"] = v;
  });
  var __importStar = exports2 && exports2.__importStar || function() {
    var ownKeys = function(o) {
      ownKeys = Object.getOwnPropertyNames || function(o) {
        var ar = [];
        for (var k in o)
          if (Object.prototype.hasOwnProperty.call(o, k))
            ar[ar.length] = k;
        return ar;
      };
      return ownKeys(o);
    };
    return function(mod) {
      if (mod && mod.__esModule)
        return mod;
      var result = {};
      if (mod != null) {
        for (var k = ownKeys(mod), i = 0;i < k.length; i++)
          if (k[i] !== "default")
            __createBinding(result, mod, k[i]);
      }
      __setModuleDefault(result, mod);
      return result;
    };
  }();
  Object.defineProperty(exports2, "__esModule", { value: true });
  exports2.HOOKS_FILE_RELATIVE = undefined;
  exports2.validateHooksConfig = validateHooksConfig;
  exports2.loadHooksConfig = loadHooksConfig;
  var fs = __importStar(require("fs"));
  var path = __importStar(require("path"));
  var yaml = __importStar(require_js_yaml());
  var types_1 = require_types2();
  var type_guards_1 = require_type_guards();
  exports2.HOOKS_FILE_RELATIVE = ".ensemble/hooks.yaml";
  var COMMAND_NAME_RE = /^ensemble:[a-z0-9][a-z0-9-]*$/;
  var SELECTION_KEYS = ["start", "end"];
  var ERROR_POLICIES = ["continue", "block"];
  function defaultFileExists(absolutePath) {
    try {
      return fs.statSync(absolutePath).isFile();
    } catch {
      return false;
    }
  }
  function checkUnknownFields(obj, allowed, at, errors) {
    for (const key of Object.keys(obj)) {
      if (!allowed.includes(key)) {
        errors.push({ path: `${at}.${key}`, message: `unknown field "${key}"` });
      }
    }
  }
  function validateHandler(name, raw, opts, fileExists, errors) {
    const at = `hooks.${name}`;
    if (!(0, type_guards_1.isRecord)(raw)) {
      errors.push({ path: at, message: `handler "${name}" must be a mapping` });
      return;
    }
    const before = errors.length;
    const type = raw.type;
    if (type === undefined) {
      errors.push({ path: `${at}.type`, message: `handler "${name}" is missing required field "type" (shell or prompt)` });
    } else if (type !== "shell" && type !== "prompt") {
      errors.push({ path: `${at}.type`, message: `handler "${name}" has invalid type ${JSON.stringify(type)} (expected shell or prompt)` });
    }
    const common = ["type", "timeout_ms", "on_error"];
    if (type === "shell")
      checkUnknownFields(raw, [...common, "command", "args"], at, errors);
    else if (type === "prompt")
      checkUnknownFields(raw, [...common, "prompt"], at, errors);
    else
      checkUnknownFields(raw, [...common, "command", "args", "prompt"], at, errors);
    let onError;
    if (raw.on_error === undefined) {
      errors.push({ path: `${at}.on_error`, message: `handler "${name}" is missing required field "on_error" (continue or block); no default is applied` });
    } else if (!ERROR_POLICIES.includes(raw.on_error)) {
      errors.push({ path: `${at}.on_error`, message: `handler "${name}" has invalid on_error ${JSON.stringify(raw.on_error)} (expected continue or block)` });
    } else {
      onError = raw.on_error;
    }
    let timeout;
    if (raw.timeout_ms !== undefined) {
      if (typeof raw.timeout_ms !== "number" || !Number.isInteger(raw.timeout_ms) || raw.timeout_ms <= 0) {
        errors.push({ path: `${at}.timeout_ms`, message: `handler "${name}" has invalid timeout_ms ${JSON.stringify(raw.timeout_ms)} (expected a positive integer number of milliseconds)` });
      } else {
        timeout = raw.timeout_ms;
      }
    }
    if (type === "shell") {
      const command = raw.command;
      let args = [];
      if (typeof command !== "string" || command.trim() === "") {
        errors.push({ path: `${at}.command`, message: `shell handler "${name}" is missing required field "command" (an executable path or name, never a shell line)` });
      } else if (command.includes("/") && !fileExists(path.resolve(opts.projectRoot, command))) {
        errors.push({ path: `${at}.command`, message: `shell handler "${name}" names a missing executable file: ${command}` });
      }
      if (raw.args !== undefined) {
        if (!Array.isArray(raw.args) || !raw.args.every((a) => typeof a === "string")) {
          errors.push({ path: `${at}.args`, message: `shell handler "${name}" has invalid args (expected an array of strings)` });
        } else {
          args = raw.args;
        }
      }
      if (errors.length > before || onError === undefined || typeof command !== "string")
        return;
      return { type: "shell", command, args, timeout_ms: timeout ?? types_1.DEFAULT_SHELL_TIMEOUT_MS, on_error: onError };
    }
    if (type === "prompt") {
      const promptFile = raw.prompt;
      if (typeof promptFile !== "string" || promptFile.trim() === "") {
        errors.push({ path: `${at}.prompt`, message: `prompt handler "${name}" is missing required field "prompt" (a path to a prompt file)` });
      } else if (!fileExists(path.resolve(opts.projectRoot, promptFile))) {
        errors.push({ path: `${at}.prompt`, message: `prompt handler "${name}" names a missing prompt file: ${promptFile}` });
      }
      if (errors.length > before || onError === undefined || typeof promptFile !== "string")
        return;
      return { type: "prompt", prompt: promptFile, timeout_ms: timeout ?? types_1.DEFAULT_PROMPT_TIMEOUT_MS, on_error: onError };
    }
    return;
  }
  function validateSelection(command, raw, handlers, opts, errors) {
    const at = `commands.${command}`;
    if (!COMMAND_NAME_RE.test(command)) {
      errors.push({
        path: at,
        message: `unknown command "${command}": commands are named explicitly as "ensemble:<name>"; wildcards and groups are not supported`
      });
      return;
    }
    if (opts.knownCommands && !opts.knownCommands.has(command)) {
      errors.push({ path: at, message: `unknown command "${command}": no such Ensemble command` });
      return;
    }
    if (!(0, type_guards_1.isRecord)(raw)) {
      errors.push({ path: at, message: `command "${command}" must be a mapping with start and/or end lists` });
      return;
    }
    const before = errors.length;
    for (const key of Object.keys(raw)) {
      if (!SELECTION_KEYS.includes(key)) {
        errors.push({ path: `${at}.${key}`, message: `command "${command}" has unknown event name "${key}" (expected "start" or "end")` });
      }
    }
    const selection = { start: [], end: [] };
    for (const key of SELECTION_KEYS) {
      const list = raw[key];
      if (list === undefined)
        continue;
      if (!Array.isArray(list) || !list.every((n) => typeof n === "string")) {
        errors.push({ path: `${at}.${key}`, message: `command "${command}" ${key} must be a list of handler names` });
        continue;
      }
      list.forEach((handlerName, i) => {
        const entry = `${at}.${key}[${i}]`;
        if (!Object.prototype.hasOwnProperty.call(handlers, handlerName)) {
          errors.push({ path: entry, message: `command "${command}" ${key} references unknown handler "${handlerName}"` });
          return;
        }
        const handler = handlers[handlerName];
        if (key === "end" && handler && handler.on_error === "block") {
          errors.push({
            path: entry,
            message: `command "${command}" end selects handler "${handlerName}" which has on_error "block"; block is only valid for start handlers`
          });
        }
        selection[key].push(handlerName);
      });
    }
    if (errors.length === before && selection.start.length === 0 && selection.end.length === 0) {
      errors.push({ path: at, message: `command "${command}" has no event selection (give it a non-empty start and/or end list)` });
    }
    return errors.length > before ? undefined : selection;
  }
  function validateHooksConfig(raw, opts) {
    const errors = [];
    const fileExists = opts.fileExists ?? defaultFileExists;
    if (!(0, type_guards_1.isRecord)(raw)) {
      return { ok: false, errors: [{ path: "", message: "the hooks file must be a mapping with version, hooks and commands" }] };
    }
    checkUnknownFields(raw, ["version", "hooks", "commands"], "", errors);
    for (const e of errors)
      e.path = e.path.replace(/^\./, "");
    if (raw.version !== 1) {
      errors.push({ path: "version", message: `version must be 1, got ${JSON.stringify(raw.version)}` });
    }
    const handlers = {};
    if (!(0, type_guards_1.isRecord)(raw.hooks)) {
      errors.push({ path: "hooks", message: `"hooks" must be a mapping of handler name to handler` });
    } else {
      for (const [name, h] of Object.entries(raw.hooks)) {
        handlers[name] = validateHandler(name, h, opts, fileExists, errors);
      }
    }
    const commands = {};
    if (!(0, type_guards_1.isRecord)(raw.commands)) {
      errors.push({ path: "commands", message: `"commands" must be a mapping of command name to its start/end selection` });
    } else {
      for (const [command, sel] of Object.entries(raw.commands)) {
        const result = validateSelection(command, sel, handlers, opts, errors);
        if (result)
          commands[command] = result;
      }
    }
    if (errors.length > 0)
      return { ok: false, errors };
    const defined = {};
    for (const [name, h] of Object.entries(handlers))
      if (h)
        defined[name] = h;
    return { ok: true, config: { version: 1, hooks: defined, commands } };
  }
  function loadHooksConfig(projectRoot, opts) {
    const file = path.join(projectRoot, exports2.HOOKS_FILE_RELATIVE);
    if (!(opts?.fileExists ?? defaultFileExists)(file))
      return { status: "absent" };
    let parsed;
    try {
      parsed = yaml.load(fs.readFileSync(file, "utf8"));
    } catch (e) {
      return { status: "invalid", errors: [{ path: exports2.HOOKS_FILE_RELATIVE, message: `could not parse the hooks file: ${e.message}` }] };
    }
    const result = validateHooksConfig(parsed, { ...opts, projectRoot });
    return result.ok ? { status: "valid", config: result.config } : { status: "invalid", errors: result.errors };
  }
});

// ../agent-core/dist/lifecycle-hooks/payload.js
var require_payload = __commonJS(function(exports2) {
  Object.defineProperty(exports2, "__esModule", { value: true });
  exports2.SENSITIVE_VARIABLE_NAMES = exports2.SECRET_PATTERNS = exports2.REDACTION_MARKER = undefined;
  exports2.redactText = redactText;
  exports2.buildStartEvent = buildStartEvent;
  exports2.buildEndEvent = buildEndEvent;
  exports2.serializeEvent = serializeEvent;
  exports2.REDACTION_MARKER = "[REDACTED]";
  var VALUE = String.raw`"[^"]*(?:"|$)|'[^']*(?:'|$)|\S+`;
  var SECRET_WORDS = String.raw`api[_-]?key|apikey|token|secret|password|passwd`;
  exports2.SECRET_PATTERNS = Object.freeze([
    {
      name: "private-key-block",
      pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g
    },
    {
      name: "bearer-token",
      pattern: /(?<=\bBearer\s+)[A-Za-z0-9._~+/-]{20,}=*/gi
    },
    {
      name: "secret-key-value",
      pattern: new RegExp(String.raw`(?<=(?:${SECRET_WORDS})["']?\s*=\s*)(?:${VALUE})`, "gi")
    },
    {
      name: "secret-flag-value",
      pattern: new RegExp(String.raw`(?<=--[\w-]*(?:${SECRET_WORDS})\s+)(?!-)(?:${VALUE})`, "gi")
    },
    {
      name: "url-credentials",
      pattern: /(?<=\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)[^\s/@]+(?=@)/gi
    },
    { name: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g },
    {
      name: "aws-access-key-id",
      pattern: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA|ANVA|AIPA)[A-Z0-9]{16}\b/g
    },
    {
      name: "github-token",
      pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b/g
    },
    { name: "slack-token", pattern: /\bxox[abeoprs]-[A-Za-z0-9-]{10,}/g },
    { name: "npm-token", pattern: /\bnpm_[A-Za-z0-9]{36}\b/g },
    { name: "google-api-key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
    { name: "api-secret-key", pattern: /\bsk-[A-Za-z0-9_-]{20,}/g },
    {
      name: "long-hex",
      pattern: /(?<![0-9A-Za-z])(?:[0-9a-fA-F]{32,39}|[0-9a-fA-F]{41,})(?![0-9A-Za-z])/g
    },
    {
      name: "long-base64",
      pattern: /(?<![A-Za-z0-9+/_.-])(?=[A-Za-z0-9+/]*\d)(?=[A-Za-z0-9+/]*[a-z])(?=[A-Za-z0-9+/]*[A-Z])[A-Za-z0-9+/]{40,}={0,2}(?![A-Za-z0-9+/_-])/g
    }
  ]);
  exports2.SENSITIVE_VARIABLE_NAMES = Object.freeze([
    "TOKEN",
    "SECRET",
    "PASSWORD",
    "PASSWD",
    "API_KEY",
    "APIKEY",
    "CREDENTIALS",
    "*_TOKEN",
    "*_SECRET",
    "*_PASSWORD",
    "*_PASSWD",
    "*_API_KEY",
    "*_APIKEY",
    "*_ACCESS_KEY",
    "*_SECRET_KEY",
    "*_PRIVATE_KEY",
    "*_CREDENTIALS",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN"
  ]);
  var SENSITIVE_NAME_REGEXES = exports2.SENSITIVE_VARIABLE_NAMES.map((glob) => new RegExp(`^${glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[A-Z0-9_]*")}$`));
  function isSensitiveName(name) {
    const normalized = name.toUpperCase().replace(/-/g, "_");
    return SENSITIVE_NAME_REGEXES.some((re) => re.test(normalized));
  }
  var ASSIGNMENT = new RegExp(String.raw`(?<![\w-])((?:--)?)([A-Za-z_][\w-]*)(=)(${VALUE})`, "g");
  var VARIABLE_REFERENCE = /\$(?:\{([A-Za-z_]\w*)\}|([A-Za-z_]\w*))/g;
  function redactText(text) {
    let out = text.replace(ASSIGNMENT, (match, prefix, name, eq) => isSensitiveName(name) ? `${prefix}${name}${eq}${exports2.REDACTION_MARKER}` : match);
    out = out.replace(VARIABLE_REFERENCE, (match, braced, bare) => isSensitiveName(braced ?? bare) ? exports2.REDACTION_MARKER : match);
    for (const { pattern } of exports2.SECRET_PATTERNS) {
      out = out.replace(pattern, exports2.REDACTION_MARKER);
    }
    return out;
  }
  function baseFields(input) {
    return {
      run_id: input.run_id,
      command: input.command,
      arguments: redactText(input.arguments),
      cwd: input.cwd,
      session_id: input.session_id,
      timestamp: input.timestamp ?? new Date().toISOString()
    };
  }
  function buildStartEvent(input) {
    const { run_id, command, arguments: args, cwd, session_id, timestamp } = baseFields(input);
    return { event: "command.start", run_id, command, arguments: args, cwd, session_id, timestamp };
  }
  function buildEndEvent(input) {
    const { run_id, command, arguments: args, cwd, session_id, timestamp } = baseFields(input);
    const event = {
      event: "command.end",
      run_id,
      command,
      arguments: args,
      cwd,
      session_id,
      timestamp,
      outcome: input.outcome,
      duration_ms: input.duration_ms
    };
    if (input.reason !== undefined)
      event.reason = redactText(input.reason);
    if (input.artifacts !== undefined)
      event.artifacts = input.artifacts.map(redactText);
    if (input.summary !== undefined)
      event.summary = redactText(input.summary);
    return event;
  }
  function serializeEvent(event) {
    return JSON.stringify({
      event: event.event,
      run_id: event.run_id,
      command: event.command,
      arguments: event.arguments,
      cwd: event.cwd,
      session_id: event.session_id,
      timestamp: event.timestamp,
      outcome: event.outcome,
      duration_ms: event.duration_ms,
      reason: event.reason,
      artifacts: event.artifacts,
      summary: event.summary
    });
  }
});

// ../agent-core/dist/lifecycle-hooks/prompt-runner.js
var require_prompt_runner = __commonJS(function(exports2) {
  var __createBinding = exports2 && exports2.__createBinding || (Object.create ? function(o, m, k, k2) {
    if (k2 === undefined)
      k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() {
        return m[k];
      } };
    }
    Object.defineProperty(o, k2, desc);
  } : function(o, m, k, k2) {
    if (k2 === undefined)
      k2 = k;
    o[k2] = m[k];
  });
  var __setModuleDefault = exports2 && exports2.__setModuleDefault || (Object.create ? function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
  } : function(o, v) {
    o["default"] = v;
  });
  var __importStar = exports2 && exports2.__importStar || function() {
    var ownKeys = function(o) {
      ownKeys = Object.getOwnPropertyNames || function(o) {
        var ar = [];
        for (var k in o)
          if (Object.prototype.hasOwnProperty.call(o, k))
            ar[ar.length] = k;
        return ar;
      };
      return ownKeys(o);
    };
    return function(mod) {
      if (mod && mod.__esModule)
        return mod;
      var result = {};
      if (mod != null) {
        for (var k = ownKeys(mod), i = 0;i < k.length; i++)
          if (k[i] !== "default")
            __createBinding(result, mod, k[i]);
      }
      __setModuleDefault(result, mod);
      return result;
    };
  }();
  Object.defineProperty(exports2, "__esModule", { value: true });
  exports2.parsePromptResponse = parsePromptResponse;
  exports2.runPromptHandler = runPromptHandler;
  var node_fs_1 = require("node:fs");
  var path = __importStar(require("node:path"));
  var type_guards_1 = require_type_guards();
  var RESPONSE_KEYS = ["continue", "message", "findings"];
  var SEVERITIES = ["info", "warning", "error"];
  function topLevelObjectSpans(text) {
    const spans = [];
    let i = 0;
    while (i < text.length) {
      if (text[i] !== "{") {
        i++;
        continue;
      }
      let depth = 0;
      let inString = false;
      let end = -1;
      for (let j = i;j < text.length; j++) {
        const ch = text[j];
        if (inString) {
          if (ch === "\\")
            j++;
          else if (ch === '"')
            inString = false;
        } else if (ch === '"') {
          inString = true;
        } else if (ch === "{") {
          depth++;
        } else if (ch === "}") {
          depth--;
          if (depth === 0) {
            end = j;
            break;
          }
        }
      }
      if (end === -1)
        return { error: "response contains an unterminated JSON object" };
      spans.push(text.slice(i, end + 1));
      i = end + 1;
    }
    return { spans };
  }
  function extractJsonObject(text) {
    const trimmed = text.trim();
    if (trimmed === "")
      return { error: "response is empty" };
    try {
      return { value: JSON.parse(trimmed) };
    } catch {}
    const found = topLevelObjectSpans(trimmed);
    if ("error" in found)
      return found;
    const parsed = [];
    for (const span of found.spans) {
      try {
        const value = JSON.parse(span);
        if ((0, type_guards_1.isRecord)(value))
          parsed.push(value);
      } catch {}
    }
    if (parsed.length === 0)
      return { error: "response contains no JSON object" };
    if (parsed.length > 1)
      return { error: "response contains more than one JSON object" };
    return { value: parsed[0] };
  }
  function validateFinding(raw, index) {
    const at = `findings[${index}]`;
    if (!(0, type_guards_1.isRecord)(raw))
      return { error: `${at} must be an object` };
    if (typeof raw.message !== "string")
      return { error: `${at}.message must be a string` };
    const finding = { message: raw.message };
    if (raw.severity !== undefined) {
      if (typeof raw.severity !== "string" || !SEVERITIES.includes(raw.severity)) {
        return { error: `${at}.severity must be one of info, warning, error` };
      }
      finding.severity = raw.severity;
    }
    if (raw.path !== undefined) {
      if (typeof raw.path !== "string")
        return { error: `${at}.path must be a string` };
      finding.path = raw.path;
    }
    return { finding };
  }
  function parsePromptResponse(text) {
    if (typeof text !== "string")
      return { ok: false, reason: "response is not text" };
    const extracted = extractJsonObject(text);
    if ("error" in extracted)
      return { ok: false, reason: extracted.error };
    const value = extracted.value;
    if (!(0, type_guards_1.isRecord)(value))
      return { ok: false, reason: "response is not a JSON object" };
    const extras = Object.keys(value).filter((key) => !RESPONSE_KEYS.includes(key));
    if (extras.length > 0) {
      return { ok: false, reason: `response has unexpected field(s): ${extras.join(", ")}` };
    }
    if (typeof value.continue !== "boolean") {
      return { ok: false, reason: 'response field "continue" must be a boolean' };
    }
    if (value.message !== undefined && typeof value.message !== "string") {
      return { ok: false, reason: 'response field "message" must be a string' };
    }
    const response = { continue: value.continue };
    if (value.message !== undefined)
      response.message = value.message;
    if (value.findings !== undefined) {
      if (!Array.isArray(value.findings)) {
        return { ok: false, reason: 'response field "findings" must be an array' };
      }
      const findings = [];
      for (let i = 0;i < value.findings.length; i++) {
        const result = validateFinding(value.findings[i], i);
        if ("error" in result)
          return { ok: false, reason: result.error };
        findings.push(result.finding);
      }
      response.findings = findings;
    }
    return { ok: true, response };
  }
  var TIMED_OUT = Symbol("prompt-evaluator-timed-out");
  function errorText(error) {
    return error instanceof Error ? error.message : String(error);
  }
  async function runPromptHandler(name, handler, eventJson, evaluator, options = {}) {
    const started = Date.now();
    const outcome = (fields) => ({
      handler: name,
      duration_ms: Date.now() - started,
      ...fields
    });
    const projectRoot = options.projectRoot ?? process.cwd();
    const readFile = options.readFile ?? ((file) => node_fs_1.promises.readFile(file, "utf8"));
    let prompt;
    try {
      prompt = await readFile(path.resolve(projectRoot, handler.prompt));
    } catch (error) {
      return outcome({ status: "failed", message: `could not read prompt file ${handler.prompt}: ${errorText(error)}` });
    }
    const controller = new AbortController;
    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve(TIMED_OUT);
      }, handler.timeout_ms);
    });
    let raw;
    try {
      const evaluation = Promise.resolve().then(() => evaluator({ prompt, eventJson, timeoutMs: handler.timeout_ms, signal: controller.signal }));
      evaluation.catch(() => {
        return;
      });
      raw = await Promise.race([evaluation, timeout]);
    } catch (error) {
      return outcome({ status: "failed", message: `prompt evaluation failed: ${errorText(error)}` });
    } finally {
      clearTimeout(timer);
    }
    if (raw === TIMED_OUT) {
      return outcome({ status: "timed_out", message: `prompt handler exceeded its ${handler.timeout_ms}ms timeout` });
    }
    const parsed = parsePromptResponse(raw);
    if (!parsed.ok) {
      return outcome({ status: "failed", message: `malformed prompt response: ${parsed.reason}` });
    }
    const { response } = parsed;
    const fields = {
      status: response.continue ? "succeeded" : "failed"
    };
    if (response.message !== undefined)
      fields.message = response.message;
    else if (!response.continue)
      fields.message = "prompt handler responded continue: false";
    if (response.findings !== undefined)
      fields.findings = response.findings;
    return outcome(fields);
  }
});

// ../agent-core/dist/lifecycle-hooks/run-tracker.js
var require_run_tracker = __commonJS(function(exports2) {
  Object.defineProperty(exports2, "__esModule", { value: true });
  exports2.CommandRunTracker = undefined;
  var node_crypto_1 = require("node:crypto");
  var MAX_ID_ATTEMPTS = 8;

  class CommandRunTracker {
    sessionId;
    now;
    newId;
    usedIds = new Set;
    active;
    constructor(options) {
      this.sessionId = options.sessionId;
      this.now = options.now ?? Date.now;
      this.newId = options.newId ?? node_crypto_1.randomUUID;
    }
    begin(input) {
      const runId = this.uniqueId();
      const superseded = this.end("cancelled", {
        reason: `No completion signal was received before the next command (${input.command}) began; the previous run was superseded.`
      });
      const run = {
        run_id: runId,
        command: input.command,
        arguments: input.arguments,
        cwd: input.cwd,
        session_id: this.sessionId,
        started_at: this.now()
      };
      this.active = run;
      return superseded ? { run: { ...run }, superseded } : { run: { ...run } };
    }
    complete(input) {
      return this.end(input.outcome, {
        reason: input.reason,
        summary: input.summary,
        artifacts: input.artifacts
      });
    }
    fail(reason) {
      return this.end("failed", { reason });
    }
    cancel(reason) {
      return this.end("cancelled", { reason });
    }
    blockedAtStart(handlerName) {
      return this.end("failed", {
        reason: `Blocked by start handler "${handlerName}".`
      });
    }
    shutdown() {
      return this.end("cancelled", {
        reason: "No completion signal was received before the session ended."
      });
    }
    current() {
      return this.active ? { ...this.active } : undefined;
    }
    end(outcome, detail) {
      const run = this.active;
      if (!run)
        return;
      this.active = undefined;
      const result = {
        run_id: run.run_id,
        command: run.command,
        arguments: run.arguments,
        cwd: run.cwd,
        session_id: run.session_id,
        outcome,
        duration_ms: Math.max(0, this.now() - run.started_at)
      };
      if (detail.reason !== undefined)
        result.reason = detail.reason;
      if (detail.summary !== undefined)
        result.summary = detail.summary;
      if (detail.artifacts !== undefined)
        result.artifacts = [...detail.artifacts];
      return result;
    }
    uniqueId() {
      for (let attempt = 0;attempt < MAX_ID_ATTEMPTS; attempt++) {
        const id = this.newId();
        if (!this.usedIds.has(id)) {
          this.usedIds.add(id);
          return id;
        }
      }
      throw new Error(`Could not produce a run id unique within session ${this.sessionId} after ${MAX_ID_ATTEMPTS} attempts.`);
    }
  }
  exports2.CommandRunTracker = CommandRunTracker;
});

// ../agent-core/dist/lifecycle-hooks/shell-runner.js
var require_shell_runner = __commonJS(function(exports2) {
  var __createBinding = exports2 && exports2.__createBinding || (Object.create ? function(o, m, k, k2) {
    if (k2 === undefined)
      k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() {
        return m[k];
      } };
    }
    Object.defineProperty(o, k2, desc);
  } : function(o, m, k, k2) {
    if (k2 === undefined)
      k2 = k;
    o[k2] = m[k];
  });
  var __setModuleDefault = exports2 && exports2.__setModuleDefault || (Object.create ? function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
  } : function(o, v) {
    o["default"] = v;
  });
  var __importStar = exports2 && exports2.__importStar || function() {
    var ownKeys = function(o) {
      ownKeys = Object.getOwnPropertyNames || function(o) {
        var ar = [];
        for (var k in o)
          if (Object.prototype.hasOwnProperty.call(o, k))
            ar[ar.length] = k;
        return ar;
      };
      return ownKeys(o);
    };
    return function(mod) {
      if (mod && mod.__esModule)
        return mod;
      var result = {};
      if (mod != null) {
        for (var k = ownKeys(mod), i = 0;i < k.length; i++)
          if (k[i] !== "default")
            __createBinding(result, mod, k[i]);
      }
      __setModuleDefault(result, mod);
      return result;
    };
  }();
  Object.defineProperty(exports2, "__esModule", { value: true });
  exports2.SHELL_OUTPUT_BOUND_BYTES = exports2.SHELL_ENV_ALLOWLIST = undefined;
  exports2.runShellHandler = runShellHandler;
  var child_process_1 = require("child_process");
  var fs = __importStar(require("fs"));
  var path = __importStar(require("path"));
  var perf_hooks_1 = require("perf_hooks");
  var promises_1 = require("timers/promises");
  var type_guards_1 = require_type_guards();
  exports2.SHELL_ENV_ALLOWLIST = Object.freeze([
    "PATH",
    "HOME",
    "USER",
    "LANG",
    "TMPDIR",
    "TERM",
    "ENSEMBLE_EVENT",
    "ENSEMBLE_RUN_ID",
    "ENSEMBLE_COMMAND",
    "ENSEMBLE_PROJECT_ROOT"
  ]);
  exports2.SHELL_OUTPUT_BOUND_BYTES = 64 * 1024;
  var MAX_TIMER_MS = 2 ** 31 - 1;
  var KILL_GRACE_MS = 500;
  var KILL_CONFIRM_MS = 1000;
  var GROUP_POLL_MS = 10;
  var MESSAGE_OUTPUT_CHARS = 500;
  function buildEnv(projectRoot, eventJson) {
    let event = {};
    try {
      const parsed = JSON.parse(eventJson);
      if ((0, type_guards_1.isRecord)(parsed))
        event = parsed;
    } catch {}
    const setByRunner = {
      ENSEMBLE_EVENT: event.event,
      ENSEMBLE_RUN_ID: event.run_id,
      ENSEMBLE_COMMAND: event.command,
      ENSEMBLE_PROJECT_ROOT: projectRoot
    };
    const env = {};
    for (const name of exports2.SHELL_ENV_ALLOWLIST) {
      const value = name.startsWith("ENSEMBLE_") ? setByRunner[name] : process.env[name];
      if (typeof value === "string")
        env[name] = value;
    }
    return env;
  }
  function startFailureMessage(handler, executable, projectRoot, error) {
    const code = (0, type_guards_1.isRecord)(error) ? error.code : undefined;
    const prefix = `could not start "${handler.command}"`;
    if (code === "ENOENT") {
      if (!fs.existsSync(projectRoot))
        return `${prefix}: the project root does not exist: ${projectRoot}`;
      if (handler.command.includes("/")) {
        return fs.existsSync(executable) ? `${prefix}: the file exists but could not be executed (is its #! interpreter installed?)` : `${prefix}: no such file: ${executable}`;
      }
      const hint = /\s/.test(handler.command) ? " (`command` is one executable, not a shell line; put arguments in `args`)" : "";
      return `${prefix}: no executable named "${handler.command}" on PATH${hint}`;
    }
    if (code === "EACCES")
      return `${prefix}: permission denied (is the file executable?)`;
    return `${prefix}: ${(0, type_guards_1.isRecord)(error) && typeof error.message === "string" ? error.message : String(error)}`;
  }
  function outputTail(chunks) {
    const text = Buffer.concat(chunks).toString("utf8").trim();
    return text.length > MESSAGE_OUTPUT_CHARS ? `…${text.slice(-MESSAGE_OUTPUT_CHARS)}` : text;
  }
  function signalGroup(pgid, signal) {
    try {
      process.kill(-pgid, signal);
    } catch {}
  }
  function groupAlive(pgid) {
    try {
      process.kill(-pgid, 0);
      return true;
    } catch (error) {
      return error.code === "EPERM";
    }
  }
  async function groupGone(pgid, withinMs) {
    const deadline = perf_hooks_1.performance.now() + withinMs;
    while (groupAlive(pgid)) {
      if (perf_hooks_1.performance.now() >= deadline)
        return false;
      await (0, promises_1.setTimeout)(GROUP_POLL_MS);
    }
    return true;
  }
  async function terminateTree(pid) {
    if (process.platform === "win32") {
      return (0, child_process_1.spawnSync)("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }).status === 0;
    }
    signalGroup(pid, "SIGTERM");
    if (await groupGone(pid, KILL_GRACE_MS))
      return true;
    signalGroup(pid, "SIGKILL");
    return groupGone(pid, KILL_CONFIRM_MS);
  }
  function runShellHandler(name, handler, eventJson, options = {}) {
    const startedAt = perf_hooks_1.performance.now();
    const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
    const executable = handler.command.includes("/") ? path.resolve(projectRoot, handler.command) : handler.command;
    return new Promise((resolve) => {
      const chunks = [];
      let captured = 0;
      let truncated = false;
      let finished = false;
      let timedOut = false;
      let timer;
      const finish = (result) => {
        if (finished)
          return;
        finished = true;
        clearTimeout(timer);
        const output = outputTail(chunks);
        const message = result.reason && output ? `${result.reason}: ${output}` : result.reason || output;
        const outcome = {
          handler: name,
          status: result.status,
          duration_ms: Math.round(perf_hooks_1.performance.now() - startedAt)
        };
        if (result.exit_code !== undefined)
          outcome.exit_code = result.exit_code;
        if (truncated)
          outcome.truncated = true;
        if (message)
          outcome.message = message;
        resolve(outcome);
      };
      const capture = (chunk) => {
        const room = exports2.SHELL_OUTPUT_BOUND_BYTES - captured;
        if (chunk.length > room)
          truncated = true;
        if (room > 0) {
          const kept = chunk.subarray(0, room);
          chunks.push(kept);
          captured += kept.length;
        }
      };
      let child;
      try {
        child = (0, child_process_1.spawn)(executable, handler.args, {
          cwd: projectRoot,
          env: buildEnv(projectRoot, eventJson),
          shell: false,
          detached: process.platform !== "win32",
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"]
        });
      } catch (error) {
        finish({ status: "failed", reason: startFailureMessage(handler, executable, projectRoot, error) });
        return;
      }
      child.on("error", (error) => finish({ status: "failed", reason: startFailureMessage(handler, executable, projectRoot, error) }));
      const pid = child.pid;
      if (pid === undefined)
        return;
      for (const stream of [child.stdin, child.stdout, child.stderr])
        stream.on("error", () => {
          return;
        });
      child.stdout.on("data", capture);
      child.stderr.on("data", capture);
      child.stdin.end(eventJson);
      child.on("close", (code, signal) => {
        if (timedOut)
          return;
        if (code === 0)
          finish({ status: "succeeded", exit_code: 0 });
        else if (code !== null)
          finish({ status: "failed", exit_code: code, reason: `exited with code ${code}` });
        else
          finish({ status: "failed", reason: `terminated by signal ${signal}` });
      });
      timer = setTimeout(() => {
        timedOut = true;
        terminateTree(pid).then((gone) => {
          child.stdout.destroy();
          child.stderr.destroy();
          const ending = gone ? "and was terminated" : "and was killed, but could not confirm that all of its processes exited";
          finish({ status: "timed_out", reason: `timed out after ${handler.timeout_ms} ms ${ending}` });
        });
      }, Math.min(handler.timeout_ms, MAX_TIMER_MS));
    });
  }
});

// ../agent-core/dist/lifecycle-hooks/dispatch.js
var require_dispatch = __commonJS(function(exports2) {
  Object.defineProperty(exports2, "__esModule", { value: true });
  exports2.dispatchHandlers = dispatchHandlers;
  async function runOne(name, config, eventJson, runners) {
    if (!Object.hasOwn(config.hooks, name)) {
      const message = `handler "${name}" is selected but not defined in hooks`;
      return { outcome: { handler: name, status: "failed", duration_ms: 0, message } };
    }
    const handler = config.hooks[name];
    const started = performance.now();
    try {
      const outcome = handler.type === "shell" ? await runners.shell(name, handler, eventJson) : await runners.prompt(name, handler, eventJson);
      return { handler, outcome };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return {
        handler,
        outcome: {
          handler: name,
          status: "failed",
          duration_ms: Math.round(performance.now() - started),
          message: `handler runner threw: ${reason}`
        }
      };
    }
  }
  async function dispatchHandlers(input) {
    const { config, command, event, eventJson, runners } = input;
    const selection = Object.hasOwn(config.commands, command) ? config.commands[command] : undefined;
    const names = selection?.[event] ?? [];
    const outcomes = [];
    for (const name of names) {
      const { handler, outcome } = await runOne(name, config, eventJson, runners);
      if (outcome.status !== "succeeded" && event === "start" && handler?.on_error === "block") {
        outcomes.push({ ...outcome, status: "blocked" });
        return { blocked: true, blockedBy: name, outcomes };
      }
      outcomes.push(outcome);
    }
    return { blocked: false, outcomes };
  }
});

// ../agent-core/dist/lifecycle-hooks/trust-store.js
var require_trust_store = __commonJS(function(exports2) {
  var __createBinding = exports2 && exports2.__createBinding || (Object.create ? function(o, m, k, k2) {
    if (k2 === undefined)
      k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() {
        return m[k];
      } };
    }
    Object.defineProperty(o, k2, desc);
  } : function(o, m, k, k2) {
    if (k2 === undefined)
      k2 = k;
    o[k2] = m[k];
  });
  var __setModuleDefault = exports2 && exports2.__setModuleDefault || (Object.create ? function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
  } : function(o, v) {
    o["default"] = v;
  });
  var __importStar = exports2 && exports2.__importStar || function() {
    var ownKeys = function(o) {
      ownKeys = Object.getOwnPropertyNames || function(o) {
        var ar = [];
        for (var k in o)
          if (Object.prototype.hasOwnProperty.call(o, k))
            ar[ar.length] = k;
        return ar;
      };
      return ownKeys(o);
    };
    return function(mod) {
      if (mod && mod.__esModule)
        return mod;
      var result = {};
      if (mod != null) {
        for (var k = ownKeys(mod), i = 0;i < k.length; i++)
          if (k[i] !== "default")
            __createBinding(result, mod, k[i]);
      }
      __setModuleDefault(result, mod);
      return result;
    };
  }();
  Object.defineProperty(exports2, "__esModule", { value: true });
  exports2.defaultTrustStorePath = defaultTrustStorePath;
  exports2.computeHooksDigest = computeHooksDigest;
  exports2.recordTrust = recordTrust;
  exports2.isTrusted = isTrusted;
  exports2.describeHooksForTrust = describeHooksForTrust;
  var node_crypto_1 = require("node:crypto");
  var fs = __importStar(require("node:fs"));
  var os = __importStar(require("node:os"));
  var path = __importStar(require("node:path"));
  var type_guards_1 = require_type_guards();
  var config_1 = require_config();
  var STORE_VERSION = 1;
  var DIGEST_DOMAIN = "ensemble-lifecycle-hooks-trust/v1";
  var UNREADABLE = "unreadable";
  var READ_CHUNK_BYTES = 64 * 1024;
  var PLAIN_TOKEN = /^[^\s"\\,[\]\p{C}]+$/u;
  var INVISIBLE = /[\p{C}\p{Z}]/gu;
  function defaultTrustStorePath(homeDir = os.homedir()) {
    return path.join(homeDir, ".ensemble", "trusted-hooks.json");
  }
  function relativeWithin(base, target) {
    const relative = path.relative(base, target);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
      return;
    return relative.split(path.sep).join("/");
  }
  function hashFile(file) {
    let fd;
    try {
      fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
      if (!fs.fstatSync(fd).isFile())
        return UNREADABLE;
      const hash = (0, node_crypto_1.createHash)("sha256");
      const chunk = Buffer.alloc(READ_CHUNK_BYTES);
      for (;; ) {
        const read = fs.readSync(fd, chunk, 0, chunk.length, null);
        if (read === 0)
          break;
        hash.update(chunk.subarray(0, read));
      }
      return hash.digest("hex");
    } catch {
      return UNREADABLE;
    } finally {
      if (fd !== undefined)
        fs.closeSync(fd);
    }
  }
  function isRegularFile(file) {
    try {
      return fs.statSync(file).isFile();
    } catch {
      return false;
    }
  }
  function computeHooksDigest(projectRoot, config) {
    const root = path.resolve(projectRoot);
    const named = [path.resolve(root, config_1.HOOKS_FILE_RELATIVE)];
    for (const handler of Object.values(config.hooks)) {
      if (handler.type === "prompt") {
        named.push(path.resolve(root, handler.prompt));
      } else {
        if (handler.command.includes("/"))
          named.push(path.resolve(root, handler.command));
        for (const arg of handler.args) {
          const file = path.resolve(root, arg);
          if (isRegularFile(file))
            named.push(file);
        }
      }
    }
    const hashes = new Map;
    for (const file of named) {
      const identity = relativeWithin(root, file) ?? file;
      if (!hashes.has(identity))
        hashes.set(identity, hashFile(file));
    }
    const entries = [...hashes].sort((x, y) => x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0);
    return `sha256:${(0, node_crypto_1.createHash)("sha256").update(JSON.stringify([DIGEST_DOMAIN, entries])).digest("hex")}`;
  }
  function realPathAllowingMissing(target) {
    const missing = [];
    let current = target;
    for (;; ) {
      try {
        return path.join(fs.realpathSync(current), ...missing);
      } catch (error) {
        const code = error.code;
        const parent = path.dirname(current);
        if (code !== "ENOENT" && code !== "ENOTDIR" || parent === current)
          throw error;
        missing.unshift(path.basename(current));
        current = parent;
      }
    }
  }
  function locateStore(projectRoot, options) {
    const storePath = path.resolve(options.storePath ?? defaultTrustStorePath());
    const project = fs.realpathSync(projectRoot);
    if (relativeWithin(project, realPathAllowingMissing(storePath)) !== undefined) {
      throw new Error(`The trust store must be outside the repository: ${storePath} lies inside ${project}, ` + "and a repository could ship a file at that path to grant itself trust.");
    }
    return { project, storePath };
  }
  function readTrustRecords(storePath) {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(storePath, "utf8"));
    } catch {
      return;
    }
    if (!(0, type_guards_1.isRecord)(parsed) || parsed.version !== STORE_VERSION || !(0, type_guards_1.isRecord)(parsed.projects))
      return;
    const records = new Map;
    for (const [project, entry] of Object.entries(parsed.projects)) {
      if ((0, type_guards_1.isRecord)(entry) && typeof entry.digest === "string" && typeof entry.trusted_at === "string") {
        records.set(project, { digest: entry.digest, trusted_at: entry.trusted_at });
      }
    }
    return records;
  }
  function writeTrustRecords(storePath, records) {
    const dir = path.dirname(storePath);
    fs.mkdirSync(dir, { recursive: true, mode: 448 });
    const temp = path.join(dir, `.${path.basename(storePath)}.${process.pid}.${(0, node_crypto_1.randomBytes)(6).toString("hex")}.tmp`);
    const body = `${JSON.stringify({ version: STORE_VERSION, projects: Object.fromEntries(records) }, null, 2)}
`;
    const fd = fs.openSync(temp, "wx", 384);
    try {
      try {
        fs.writeFileSync(fd, body);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(temp, storePath);
    } catch (error) {
      fs.rmSync(temp, { force: true });
      throw error;
    }
  }
  function recordTrust(projectRoot, digest, options = {}) {
    const { project, storePath } = locateStore(projectRoot, options);
    const records = readTrustRecords(storePath) ?? new Map;
    records.set(project, { digest, trusted_at: (options.now?.() ?? new Date).toISOString() });
    writeTrustRecords(storePath, records);
  }
  function isTrusted(projectRoot, digest, options = {}) {
    try {
      const { project, storePath } = locateStore(projectRoot, options);
      const record = readTrustRecords(storePath)?.get(project);
      return record !== undefined && record.digest === digest;
    } catch {
      return false;
    }
  }
  function showToken(text) {
    if (PLAIN_TOKEN.test(text))
      return text;
    return JSON.stringify(text).replace(INVISIBLE, (ch) => ch === " " ? ch : `\\u{${ch.codePointAt(0)?.toString(16)}}`);
  }
  function describeHooksForTrust(config) {
    const lines = [];
    for (const [name, handler] of Object.entries(config.hooks)) {
      const what = handler.type === "shell" ? [handler.command, ...handler.args].map(showToken).join(" ") : showToken(handler.prompt);
      const limits = `timeout ${handler.timeout_ms}ms, on_error ${handler.on_error}`;
      lines.push(`${handler.type} ${showToken(name)}: ${what} (${limits})`);
    }
    for (const [command, selection] of Object.entries(config.commands)) {
      const start = selection.start.map(showToken).join(", ");
      const end = selection.end.map(showToken).join(", ");
      lines.push(`command ${showToken(command)}: start [${start}], end [${end}]`);
    }
    return lines;
  }
});

// ../agent-core/dist/lifecycle-hooks/capabilities.js
var require_capabilities = __commonJS(function(exports2) {
  Object.defineProperty(exports2, "__esModule", { value: true });
  exports2.PI_END_DEFINITION = exports2.HARNESS_CAPABILITIES = exports2.CAPABILITY_NAMES = exports2.HARNESS_NAMES = undefined;
  exports2.unsupportedHookWarnings = unsupportedHookWarnings;
  exports2.renderCapabilityTable = renderCapabilityTable;
  exports2.HARNESS_NAMES = Object.freeze(["pi", "claude-code", "codex", "opencode"]);
  exports2.CAPABILITY_NAMES = Object.freeze([
    "command_start",
    "command_end",
    "command_end_on_cancel"
  ]);
  exports2.HARNESS_CAPABILITIES = Object.freeze({
    pi: Object.freeze({ adapter: true, command_start: true, command_end: true, command_end_on_cancel: true }),
    "claude-code": Object.freeze({
      adapter: false,
      command_start: false,
      command_end: false,
      command_end_on_cancel: false
    }),
    codex: Object.freeze({ adapter: false, command_start: false, command_end: false, command_end_on_cancel: false }),
    opencode: Object.freeze({
      adapter: false,
      command_start: false,
      command_end: false,
      command_end_on_cancel: false
    })
  });
  exports2.PI_END_DEFINITION = "In Pi a command ends at the completion signal (the ensemble_command_complete tool call, handled after the " + "command's final output at agent_settled), an error outcome (agent_before_settle with outcome error), an abort " + "signal (agent_settled with aborted true; an abort emits no agent_before_settle), the next selected command's " + "input, or session shutdown. A settle that is none of these never ends a command.";
  var NEEDED_BY_SELECTION = {
    start: ["command_start"],
    end: ["command_end", "command_end_on_cancel"]
  };
  function unsupportedHookWarnings(config, harness, table = exports2.HARNESS_CAPABILITIES) {
    const supported = table[harness];
    const warnings = [];
    for (const [command, selection] of Object.entries(config.commands)) {
      for (const key of ["start", "end"]) {
        for (const hook of selection[key]) {
          const handler = config.hooks[hook];
          if (handler === undefined)
            continue;
          const target = handler.type === "shell" ? handler.command : handler.prompt;
          for (const capability of NEEDED_BY_SELECTION[key]) {
            if (supported[capability])
              continue;
            warnings.push({
              harness,
              hook,
              handler: target,
              command,
              selection: key,
              capability,
              message: `Hook "${hook}" (${handler.type} ${target}), selected by ${command} for ${key}, ` + `needs ${capability}, which ${harness} does not support; it will not run.`
            });
          }
        }
      }
    }
    return warnings;
  }
  function renderCapabilityTable(table = exports2.HARNESS_CAPABILITIES) {
    const rows = [
      ["harness", "adapter", ...exports2.CAPABILITY_NAMES],
      ...exports2.HARNESS_NAMES.map((name) => [
        name,
        table[name].adapter ? "yes" : "no",
        ...exports2.CAPABILITY_NAMES.map((capability) => table[name][capability] ? "true" : "false")
      ])
    ];
    const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)));
    const lines = rows.map((row) => row.map((cell, column) => cell.padEnd(widths[column])).join("  ").trimEnd());
    lines.push("", "Pi command end: " + exports2.PI_END_DEFINITION);
    const adapterless = exports2.HARNESS_NAMES.filter((name) => !table[name].adapter);
    if (adapterless.length > 0) {
      lines.push("", `Lifecycle hooks are not active in ${adapterless.join(", ")}: there is no adapter, so no code runs there ` + "and nothing is shown when a command runs.");
    }
    return lines.join(`
`);
  }
});

// ../agent-core/dist/lifecycle-hooks/index.js
var require_lifecycle_hooks = __commonJS(function(exports2) {
  var __createBinding = exports2 && exports2.__createBinding || (Object.create ? function(o, m, k, k2) {
    if (k2 === undefined)
      k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() {
        return m[k];
      } };
    }
    Object.defineProperty(o, k2, desc);
  } : function(o, m, k, k2) {
    if (k2 === undefined)
      k2 = k;
    o[k2] = m[k];
  });
  var __exportStar = exports2 && exports2.__exportStar || function(m, exports3) {
    for (var p in m)
      if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports3, p))
        __createBinding(exports3, m, p);
  };
  Object.defineProperty(exports2, "__esModule", { value: true });
  __exportStar(require_types2(), exports2);
  __exportStar(require_config(), exports2);
  __exportStar(require_payload(), exports2);
  __exportStar(require_prompt_runner(), exports2);
  __exportStar(require_run_tracker(), exports2);
  __exportStar(require_shell_runner(), exports2);
  __exportStar(require_dispatch(), exports2);
  __exportStar(require_trust_store(), exports2);
  __exportStar(require_capabilities(), exports2);
});

// ../agent-core/dist/index.js
var require_dist = __commonJS(function(exports2) {
  var __createBinding = exports2 && exports2.__createBinding || (Object.create ? function(o, m, k, k2) {
    if (k2 === undefined)
      k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() {
        return m[k];
      } };
    }
    Object.defineProperty(o, k2, desc);
  } : function(o, m, k, k2) {
    if (k2 === undefined)
      k2 = k;
    o[k2] = m[k];
  });
  var __exportStar = exports2 && exports2.__exportStar || function(m, exports3) {
    for (var p in m)
      if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports3, p))
        __createBinding(exports3, m, p);
  };
  Object.defineProperty(exports2, "__esModule", { value: true });
  exports2.isRecord = undefined;
  __exportStar(require_types(), exports2);
  __exportStar(require_lifecycle_hooks(), exports2);
  var type_guards_1 = require_type_guards();
  Object.defineProperty(exports2, "isRecord", { enumerable: true, get: function() {
    return type_guards_1.isRecord;
  } });
});

// src/main.ts
var exports_main = {};
__export(exports_main, {
  handleEvent: () => handleEvent,
  resolveClaudeCommand: () => resolveClaudeCommand,
  trustCommand: () => trustCommand
});
module.exports = __toCommonJS(exports_main);
var import_node_crypto2 = require("node:crypto");
var fs = __toESM(require("node:fs"));
var path = __toESM(require("node:path"));
var readline = __toESM(require("node:readline"));
var import_ensemble_agent_core2 = __toESM(require_dist());

// ../pi-extension/src/lifecycle/adapter.ts
var import_node_crypto = require("node:crypto");
var import_ensemble_agent_core = __toESM(require_dist());

// ../pi-extension/src/lifecycle/completion.ts
var COMPLETION_TOOL_NAME = "ensemble_command_complete";
var COMPLETION_INSTRUCTION = [
  "Ensemble command completion:",
  `When the Ensemble command you are running has finished its work, or has failed (for example it hit a hard stop or rejected its arguments), call the ${COMPLETION_TOOL_NAME} tool exactly once.`,
  'Use outcome "succeeded" when the work is done. Use outcome "failed" with a short reason when it is not. A summary and the paths of the artifacts you produced are optional.',
  "The tool only records how the command ended. It never names, selects or starts anything else, and you must not try to name or start any hook handler yourself."
].join(`
`);

// ../pi-extension/src/lifecycle/prompt-evaluator.ts
var PROTOCOL_SUFFIX = [
  "Respond with a single JSON object and nothing else (no prose, no code fence), of this shape:",
  '{"continue": boolean, "message"?: string, "findings"?: [{"message": string, "severity"?: "info"|"warning"|"error", "path"?: string}]}',
  'Set "continue" to false only to ask that the command be blocked.',
  "The lifecycle event you are evaluating follows."
].join(`
`);

// ../pi-extension/src/lifecycle/resolve-command.ts
var DISPATCHER_TARGETS = {
  "ensemble-prd": {
    create: "create-prd",
    refine: "refine-prd"
  },
  "ensemble-trd": {
    create: "create-trd",
    refine: "refine-trd",
    implement: "implement-trd-beads",
    analyze: "analyze-requirements",
    complexity: "analyze-complexity",
    validate: "validate-requirements",
    verify: "verify-requirements",
    status: "requirement-status",
    graph: "trd-dependency-graph"
  },
  "ensemble-issue": {
    fix: "fix-issue",
    list: "list-issue",
    resume: "fix-issue",
    status: "fix-issue",
    abandon: "fix-issue"
  },
  "ensemble-feature": {
    new: "new-feature",
    resume: "new-feature",
    status: "new-feature",
    abandon: "new-feature"
  },
  "ensemble-reqnroll": {
    features: "generate-feature-tests",
    "feature-drift": "check-feature-drift",
    bindings: "generate-reqnroll-bindings",
    "binding-drift": "check-binding-drift",
    tdd: "reqnroll-tdd"
  },
  "ensemble-standards": {
    discover: "discover-standards",
    inject: "inject-standards",
    fold: "fold-prompt"
  }
};
var KEBAB = "[a-z0-9]+(?:-[a-z0-9]+)*";
var SLASH_INPUT = new RegExp(`^/(?:(?:skill:)?(ensemble-${KEBAB})|ensemble:(${KEBAB}))(?:\\s+([\\s\\S]*))?$`);
var FIRST_TOKEN = /^(\S+)(?:\s+([\s\S]*))?$/;
function resolveCommand(inputText) {
  const match = SLASH_INPUT.exec(inputText);
  if (!match)
    return;
  const templateName = match[1];
  const forwardedName = match[2];
  const rest = match[3] ?? "";
  const name = templateName ?? `ensemble-${forwardedName}`;
  if (forwardedName !== undefined && !Object.hasOwn(DISPATCHER_TARGETS, name))
    return;
  if (!Object.hasOwn(DISPATCHER_TARGETS, name)) {
    return { command: `ensemble:${name.slice("ensemble-".length)}`, arguments: rest.trim() };
  }
  const keywordMatch = FIRST_TOKEN.exec(rest.trim());
  if (!keywordMatch)
    return;
  const targets = DISPATCHER_TARGETS[name];
  const keyword = keywordMatch[1];
  if (!Object.hasOwn(targets, keyword))
    return;
  return { command: `ensemble:${targets[keyword]}`, arguments: (keywordMatch[2] ?? "").trim() };
}

// ../pi-extension/src/lifecycle/adapter.ts
var TRUST_COMMAND_NAME = "ensemble-lifecycle-trust";
function escapeInvisible(text) {
  return text.replace(/[\p{C}\p{Z}]/gu, (ch) => ch === " " ? ch : `\\u{${ch.codePointAt(0)?.toString(16)}}`);
}
function errorLines(errors) {
  return errors.map((e) => `  - ${escapeInvisible(e.path ? `${e.path}: ${e.message}` : e.message)}`);
}
function evaluateHooksGate(input) {
  const { projectRoot, command, knownCommands, host, trust } = input;
  const loaded = import_ensemble_agent_core.loadHooksConfig(projectRoot, { knownCommands });
  if (loaded.status === "absent")
    return { active: false, reason: "no-hooks-file" };
  if (loaded.status === "invalid") {
    const userMessage = [
      `Ensemble lifecycle hooks did not run: ${import_ensemble_agent_core.HOOKS_FILE_RELATIVE} is invalid.`,
      ...errorLines(loaded.errors),
      "Hooks run again once the file is valid and trusted."
    ].join(`
`);
    return { active: false, reason: "invalid-config", userMessage };
  }
  const { config } = loaded;
  if (!Object.hasOwn(config.commands, command))
    return { active: false, reason: "not-selected" };
  const hostTrusted = typeof host.isProjectTrusted === "function" ? host.isProjectTrusted() : undefined;
  if (typeof hostTrusted !== "boolean") {
    const userMessage = `Ensemble lifecycle hooks in ${import_ensemble_agent_core.HOOKS_FILE_RELATIVE} did not run for ${command}: ` + "Pi gave this session no project-trust decision (ctx.isProjectTrusted is not available), " + "and hooks run only in a project the host reports as trusted.";
    return { active: false, reason: "host-trust-unavailable", userMessage };
  }
  if (!hostTrusted) {
    const userMessage = `Ensemble lifecycle hooks in ${import_ensemble_agent_core.HOOKS_FILE_RELATIVE} did not run for ${command}: Pi does not trust this project. ` + "Trust it in Pi (run /trust to save the decision, or start Pi with --approve) and run the command again.";
    return { active: false, reason: "host-untrusted", userMessage };
  }
  if (!import_ensemble_agent_core.isTrusted(projectRoot, import_ensemble_agent_core.computeHooksDigest(projectRoot, config), trust)) {
    const userMessage = `Ensemble lifecycle hooks in ${import_ensemble_agent_core.HOOKS_FILE_RELATIVE} did not run for ${command}: you have not trusted them, ` + `or ${import_ensemble_agent_core.HOOKS_FILE_RELATIVE} or a handler file it names has changed since you did. ` + `Review them and run /${TRUST_COMMAND_NAME} to trust them.`;
    return { active: false, reason: "user-untrusted", userMessage };
  }
  return { active: true, config };
}
var PROCESS_SESSION_ID = import_node_crypto.randomUUID();

// src/main.ts
var COLON_FORM = /^\s*\/(?:ensemble:|ensemble-[a-z0-9]+(?:-[a-z0-9]+)*:ensemble[:-])([a-z0-9][a-z0-9-]*)(?:\s+([\s\S]*))?$/;
var PROMPT_UNSUPPORTED = "prompt handlers need a model call, which a Claude Code hook cannot make; they run only in Pi";
function resolveClaudeCommand(prompt) {
  const match = COLON_FORM.exec(prompt);
  if (!match)
    return;
  if (Object.hasOwn(DISPATCHER_TARGETS, `ensemble-${match[1]}`)) {
    return resolveCommand(`/ensemble:${match[1]}${match[2] === undefined ? "" : ` ${match[2]}`}`);
  }
  return { command: `ensemble:${match[1]}`, arguments: (match[2] ?? "").trim() };
}
function stateFile(projectRoot, sessionId) {
  const safe = sessionId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 128) || "session";
  return path.join(projectRoot, ".ensemble", "lifecycle-state", `${safe}.json`);
}
function readPending(file) {
  try {
    const run = JSON.parse(fs.readFileSync(file, "utf8"));
    return typeof run.run_id === "string" && typeof run.command === "string" ? run : undefined;
  } catch {
    return;
  }
}
function writePending(file, run) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, ".gitignore"), `*
`);
  fs.writeFileSync(file, JSON.stringify(run));
}
function runners(projectRoot) {
  return {
    shell: (name, handler, eventJson) => import_ensemble_agent_core2.runShellHandler(name, handler, eventJson, { projectRoot }),
    prompt: async (name) => ({
      handler: name,
      status: "failed",
      duration_ms: 0,
      message: PROMPT_UNSUPPORTED
    })
  };
}
function problems(event, command, outcomes) {
  return outcomes.filter((o) => o.status !== "succeeded").map((o) => `Ensemble lifecycle hook "${o.handler}" ${o.status} at ${event} of ${command}${o.message ? `: ${o.message}` : ""}`);
}
function refusalNote(reason, command) {
  if (reason === "no-hooks-file" || reason === "not-selected")
    return;
  if (reason === "invalid-config")
    return `Ensemble lifecycle hooks did not run for ${command}: ${import_ensemble_agent_core2.HOOKS_FILE_RELATIVE} is invalid. Run \`node <plugin>/bundle/lifecycle.cjs trust\` in a terminal to see the errors.`;
  return `Ensemble lifecycle hooks in ${import_ensemble_agent_core2.HOOKS_FILE_RELATIVE} did not run for ${command}: you have not trusted them, or a file they name has changed since you did. Review them and run \`node <plugin>/bundle/lifecycle.cjs trust\` in a terminal in this project.`;
}
function gate(projectRoot, command) {
  return evaluateHooksGate({ projectRoot, command, host: { isProjectTrusted: () => true } });
}
async function endRun(projectRoot, run, outcome, reason) {
  const decision = gate(projectRoot, run.command);
  if (!decision.active)
    return [];
  const event = import_ensemble_agent_core2.buildEndEvent({
    run_id: run.run_id,
    command: run.command,
    arguments: run.arguments,
    cwd: run.cwd,
    session_id: run.session_id,
    outcome,
    duration_ms: Math.max(0, Date.now() - run.started_at),
    ...reason === undefined ? {} : { reason }
  });
  const result = await import_ensemble_agent_core2.dispatchHandlers({
    config: decision.config,
    command: run.command,
    event: "end",
    eventJson: import_ensemble_agent_core2.serializeEvent(event),
    runners: runners(projectRoot)
  });
  return problems("end", run.command, result.outcomes);
}
function reply(messages, extra = {}) {
  if (messages.length === 0 && Object.keys(extra).length === 0)
    return;
  const out = { ...extra };
  if (messages.length > 0)
    out.systemMessage = messages.join(`
`);
  process.stdout.write(JSON.stringify(out));
}
async function handleEvent(input, projectRoot) {
  const eventName = input.hook_event_name;
  const sessionId = typeof input.session_id === "string" ? input.session_id : "";
  if (!sessionId || typeof eventName !== "string")
    return;
  const file = stateFile(projectRoot, sessionId);
  const messages = [];
  if (eventName === "UserPromptSubmit") {
    const resolved = typeof input.prompt === "string" ? resolveClaudeCommand(input.prompt) : undefined;
    if (!resolved)
      return;
    const previous = readPending(file);
    if (previous) {
      fs.rmSync(file, { force: true });
      messages.push(...await endRun(projectRoot, previous, "cancelled", `No completion signal was received before the next command (${resolved.command}) began.`));
    }
    const decision = gate(projectRoot, resolved.command);
    if (!decision.active) {
      const note = refusalNote(decision.reason, resolved.command);
      if (note)
        messages.push(note);
      return reply(messages);
    }
    const run = {
      run_id: import_node_crypto2.randomUUID(),
      command: resolved.command,
      arguments: resolved.arguments,
      cwd: typeof input.cwd === "string" ? input.cwd : projectRoot,
      session_id: sessionId,
      started_at: Date.now()
    };
    const event = import_ensemble_agent_core2.buildStartEvent(run);
    const result = await import_ensemble_agent_core2.dispatchHandlers({
      config: decision.config,
      command: run.command,
      event: "start",
      eventJson: import_ensemble_agent_core2.serializeEvent(event),
      runners: runners(projectRoot)
    });
    messages.push(...problems("start", run.command, result.outcomes));
    if (result.blocked) {
      const by = result.blockedBy ?? "a start handler";
      messages.push(...await endRun(projectRoot, run, "failed", `Blocked by start handler "${by}".`));
      return reply([], {
        decision: "block",
        reason: `Ensemble lifecycle hook "${by}" blocked ${run.command}.
${messages.join(`
`)}`
      });
    }
    writePending(file, run);
    return reply(messages);
  }
  const outcomeByEvent = {
    Stop: ["succeeded", undefined],
    StopFailure: ["failed", "The turn ended with an API error."],
    SessionEnd: ["cancelled", "No completion signal was received before the session ended."]
  };
  const mapped = outcomeByEvent[eventName];
  if (!mapped)
    return;
  const run = readPending(file);
  if (!run)
    return;
  fs.rmSync(file, { force: true });
  messages.push(...await endRun(projectRoot, run, mapped[0], mapped[1]));
  reply(messages);
}
async function trustCommand(projectRoot) {
  const loaded = import_ensemble_agent_core2.loadHooksConfig(projectRoot);
  if (loaded.status === "absent") {
    console.error(`${import_ensemble_agent_core2.HOOKS_FILE_RELATIVE} does not exist in ${projectRoot}; nothing to trust.`);
    return 1;
  }
  if (loaded.status === "invalid") {
    console.error([`${import_ensemble_agent_core2.HOOKS_FILE_RELATIVE} is invalid:`, ...loaded.errors.map((e) => `  - ${e.path ? `${e.path}: ` : ""}${e.message}`)].join(`
`));
    return 1;
  }
  if (!process.stdin.isTTY) {
    console.error("Trust needs an interactive terminal to confirm; nothing was recorded.");
    return 1;
  }
  const digest = import_ensemble_agent_core2.computeHooksDigest(projectRoot, loaded.config);
  console.log(["Trust this project's lifecycle hooks?", ...import_ensemble_agent_core2.describeHooksForTrust(loaded.config)].join(`
`));
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question("Type yes to trust: ", resolve));
  rl.close();
  if (answer.trim().toLowerCase() !== "yes") {
    console.log("Nothing was trusted.");
    return 1;
  }
  import_ensemble_agent_core2.recordTrust(projectRoot, digest);
  console.log(`Trusted. The hooks run until ${import_ensemble_agent_core2.HOOKS_FILE_RELATIVE} or a file it names changes.`);
  return 0;
}
async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "trust") {
    process.exitCode = await trustCommand(path.resolve(args[1] ?? process.cwd()));
    return;
  }
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(0, "utf8"));
  } catch {
    return;
  }
  const dir = process.env.CLAUDE_PROJECT_DIR || (typeof payload.cwd === "string" ? payload.cwd : process.cwd());
  try {
    await handleEvent(payload, path.resolve(dir));
  } catch (error) {
    process.stderr.write(`ensemble-lifecycle: ${error instanceof Error ? error.message : String(error)}
`);
  }
}
if (require.main == module)
  main();
