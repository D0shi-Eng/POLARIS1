// ملف مُولَّد. لا يُحرَّر بيد.
// المصدر: contracts/schemas/**.json و contracts/registry/*.json
// المولِّد: desktop/renderer/scripts/generate-contract-bundle.mjs
// أي تحرير يدوي هنا يُكشف في التحقق: `node scripts/generate-contract-bundle.mjs --check`.

export type SchemaDocument = Record<string, unknown>;

/** بصمة المصدر الذي وُلّد منه هذا الملف. */
export const CONTRACT_BUNDLE_DIGEST = "3600d3a2eb9b9fe31f22469b92083c85b1100713bc4c467a3d17a4b6dfcead32";

/** المخططات بمعرّفاتها المسارية، وهي نفس المعرّفات التي يسجّلها `contracts/src/registry.ts`. */
export const CONTRACT_SCHEMAS: Readonly<Record<string, SchemaDocument>> = {
  "common/caller-identity.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "PolarisCallerIdentity",
    "description": "Who is asking. Never optional at a trust boundary.",
    "$comment": "هوية المستدعي إلزامية عند كل حد ثقة. لا يجوز اختزالها في user_id.",
    "$defs": {
      "CallerType": {
        "title": "CallerType",
        "type": "string",
        "enum": [
          "CORE_UI",
          "USER",
          "AGENT",
          "PLUGIN",
          "SYSTEM"
        ],
        "description": "Class of principal. Closed set: an unknown caller type is a contract violation, not an extension point."
      },
      "TrustTier": {
        "title": "TrustTier",
        "type": "string",
        "enum": [
          "TIER_0_TRUSTED",
          "TIER_1_LIMITED",
          "TIER_2_UNTRUSTED"
        ],
        "description": "Disclosure tier. Internal policy reasoning is withheld from TIER_2_UNTRUSTED callers."
      },
      "PrincipalRef": {
        "title": "PrincipalRef",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "caller_type",
          "principal_id"
        ],
        "properties": {
          "caller_type": {
            "$ref": "#/$defs/CallerType"
          },
          "principal_id": {
            "$ref": "./ids.schema.json#/$defs/Uuid"
          }
        },
        "description": "Non-recursive reference to a principal. Used for one delegation hop."
      },
      "CallerIdentity": {
        "title": "CallerIdentity",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "caller_type",
          "principal_id",
          "trust_tier",
          "session_id"
        ],
        "properties": {
          "caller_type": {
            "$ref": "#/$defs/CallerType"
          },
          "principal_id": {
            "$ref": "./ids.schema.json#/$defs/Uuid"
          },
          "trust_tier": {
            "$ref": "#/$defs/TrustTier"
          },
          "session_id": {
            "$ref": "./ids.schema.json#/$defs/Uuid"
          },
          "on_behalf_of": {
            "$ref": "#/$defs/PrincipalRef",
            "description": "Delegation is explicit and exactly one hop deep. Deeper chains require a contract revision, not nesting."
          }
        },
        "allOf": [
          {
            "$comment": "AGENT و PLUGIN لا يجوز أن يكونا Tier-0.",
            "if": {
              "type": "object",
              "properties": {
                "caller_type": {
                  "enum": [
                    "AGENT",
                    "PLUGIN"
                  ]
                }
              },
              "required": [
                "caller_type"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "trust_tier": {
                  "enum": [
                    "TIER_1_LIMITED",
                    "TIER_2_UNTRUSTED"
                  ]
                }
              }
            }
          },
          {
            "$comment": "الوكيل والإضافة يعملان دائمًا نيابةً عن مبدأ معروف.",
            "if": {
              "type": "object",
              "properties": {
                "caller_type": {
                  "enum": [
                    "AGENT",
                    "PLUGIN"
                  ]
                }
              },
              "required": [
                "caller_type"
              ]
            },
            "then": {
              "type": "object",
              "required": [
                "on_behalf_of"
              ]
            }
          }
        ]
      }
    }
  } as unknown as SchemaDocument,
  "common/effect.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "PolarisEffectModel",
    "description": "Typed vocabulary for side effects. A declared effect is a REQUESTED PRIVILEGE, never a security guarantee.",
    "$comment": "الأثر المعلن = طلب صلاحية. لا يعني إطلاقًا أن الأداة آمنة أو للقراءة فقط.",
    "$defs": {
      "EffectAction": {
        "title": "EffectAction",
        "type": "string",
        "description": "Closed v1 vocabulary. Extension happens by contract version bump, not by free strings.",
        "enum": [
          "read.filesystem",
          "write.filesystem",
          "create.filesystem",
          "delete.filesystem",
          "execute.process",
          "install.package",
          "network.fetch",
          "network.send",
          "network.publish",
          "browser.navigate",
          "browser.submit",
          "email.read",
          "email.send",
          "secret.reference",
          "secret.deref",
          "memory.read",
          "memory.write",
          "system.read",
          "system.modify",
          "payment.prepare",
          "payment.commit"
        ]
      },
      "DataClassification": {
        "title": "DataClassification",
        "type": "string",
        "enum": [
          "PUBLIC",
          "INTERNAL",
          "SENSITIVE",
          "SECRET"
        ],
        "description": "Sensitivity of the data the effect touches."
      },
      "ResourceKind": {
        "title": "ResourceKind",
        "type": "string",
        "enum": [
          "FILESYSTEM_PATH",
          "PROCESS",
          "NETWORK_ENDPOINT",
          "MAILBOX",
          "SECRET_REF",
          "MEMORY_STORE",
          "SYSTEM_SETTING",
          "PAYMENT_INSTRUMENT",
          "BROWSER_TARGET"
        ]
      },
      "ResourceRef": {
        "title": "ResourceRef",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "kind",
          "locator"
        ],
        "properties": {
          "kind": {
            "$ref": "#/$defs/ResourceKind"
          },
          "locator": {
            "type": "string",
            "minLength": 1,
            "maxLength": 4096,
            "description": "Opaque to Core. Interpreted only by the platform adapter that owns the resource kind."
          },
          "scope": {
            "type": "string",
            "enum": [
              "EXACT",
              "SUBTREE"
            ],
            "description": "SUBTREE is only meaningful for hierarchical kinds such as FILESYSTEM_PATH."
          }
        }
      },
      "NetworkDestination": {
        "title": "NetworkDestination",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "host",
          "port",
          "protocol"
        ],
        "properties": {
          "host": {
            "type": "string",
            "minLength": 1,
            "maxLength": 255,
            "description": "DNS name or literal address. Wildcards are not permitted in v1."
          },
          "port": {
            "type": "integer",
            "minimum": 1,
            "maximum": 65535
          },
          "protocol": {
            "type": "string",
            "enum": [
              "HTTPS",
              "HTTP",
              "TCP",
              "UDP"
            ]
          }
        },
        "$comment": "W1 أثبت أن internetClient لا يوفر تحكمًا بالوجهة. لذلك الوجهة تُصرَّح هنا ليفرضها Egress PEP لاحقًا، لا ويندوز."
      },
      "Effect": {
        "title": "Effect",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "action"
        ],
        "properties": {
          "action": {
            "$ref": "#/$defs/EffectAction"
          },
          "resource": {
            "$ref": "#/$defs/ResourceRef"
          },
          "destination": {
            "$ref": "#/$defs/NetworkDestination"
          },
          "data_classification": {
            "$ref": "#/$defs/DataClassification"
          }
        },
        "allOf": [
          {
            "$comment": "كل أثر شبكي يجب أن يعلن وجهته صراحة.",
            "if": {
              "type": "object",
              "properties": {
                "action": {
                  "enum": [
                    "network.fetch",
                    "network.send",
                    "network.publish"
                  ]
                }
              },
              "required": [
                "action"
              ]
            },
            "then": {
              "type": "object",
              "required": [
                "destination"
              ]
            },
            "else": {
              "not": {
                "type": "object",
                "required": [
                  "destination"
                ]
              }
            }
          },
          {
            "$comment": "الأثر غير الشبكي يجب أن يحدد المورد.",
            "if": {
              "type": "object",
              "properties": {
                "action": {
                  "enum": [
                    "network.fetch",
                    "network.send",
                    "network.publish"
                  ]
                }
              },
              "required": [
                "action"
              ]
            },
            "then": true,
            "else": {
              "type": "object",
              "required": [
                "resource"
              ]
            }
          },
          {
            "$comment": "إخراج قيمة سر يستلزم تصنيف SECRET.",
            "if": {
              "type": "object",
              "properties": {
                "action": {
                  "const": "secret.deref"
                }
              },
              "required": [
                "action"
              ]
            },
            "then": {
              "type": "object",
              "required": [
                "data_classification"
              ],
              "properties": {
                "data_classification": {
                  "const": "SECRET"
                }
              }
            }
          }
        ]
      },
      "EffectList": {
        "title": "EffectList",
        "type": "array",
        "minItems": 1,
        "maxItems": 64,
        "items": {
          "$ref": "#/$defs/Effect"
        }
      }
    }
  } as unknown as SchemaDocument,
  "common/error.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "PolarisContractError",
    "description": "Typed error vocabulary. `error: string` is forbidden across every POLARIS boundary.",
    "$comment": "لا يوجد error نصي حر. كل خطأ له رمز مصنّف.",
    "$defs": {
      "ErrorCode": {
        "title": "ErrorCode",
        "type": "string",
        "enum": [
          "VALIDATION_ERROR",
          "UNSUPPORTED_VERSION",
          "POLICY_DENIED",
          "MALFORMED_MESSAGE",
          "CONTRACT_VIOLATION",
          "DEPENDENCY_UNAVAILABLE",
          "TIMEOUT",
          "CONFLICT",
          "INTERNAL_ERROR"
        ]
      },
      "ContractError": {
        "title": "ContractError",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "code",
          "display_message"
        ],
        "properties": {
          "code": {
            "$ref": "#/$defs/ErrorCode"
          },
          "display_message": {
            "type": "string",
            "minLength": 1,
            "maxLength": 512,
            "description": "Safe to show any caller at any trust tier."
          },
          "internal_detail": {
            "type": "string",
            "maxLength": 4096,
            "description": "Withheld from TIER_2_UNTRUSTED callers."
          },
          "pointer": {
            "type": "string",
            "maxLength": 512,
            "description": "RFC 6901 JSON Pointer into the offending payload."
          },
          "retryable": {
            "type": "boolean"
          }
        }
      }
    }
  } as unknown as SchemaDocument,
  "common/execution.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "PolarisExecutionRequirements",
    "description": "Platform-neutral confinement semantics. Windows and macOS adapters realise these; the contract never names a Win32 primitive.",
    "$comment": "دلالات الحصر محايدة للمنصة. AppContainer/Job Object تفاصيل تنفيذ في المحوّل، لا في العقد.",
    "$defs": {
      "NetworkRequirement": {
        "title": "NetworkRequirement",
        "type": "string",
        "enum": [
          "NONE",
          "BROKERED_EGRESS",
          "UNRESTRICTED"
        ],
        "description": "NONE: no egress path exists at all. BROKERED_EGRESS: all egress traverses the POLARIS Egress PEP against a declared destination allow-list; NOT IMPLEMENTED as of W2. UNRESTRICTED: unmediated internet; representable so policy can name and refuse it."
      },
      "FilesystemScope": {
        "title": "FilesystemScope",
        "type": "string",
        "enum": [
          "NONE",
          "EXPLICIT_GRANT",
          "USER_SCOPE",
          "UNRESTRICTED"
        ],
        "description": "EXPLICIT_GRANT: only paths granted per task, reverted on completion (the W1-proven mode)."
      },
      "ProcessTreeMode": {
        "title": "ProcessTreeMode",
        "type": "string",
        "enum": [
          "UNCONSTRAINED",
          "CONFINED_KILL_ON_CLOSE"
        ],
        "description": "CONFINED_KILL_ON_CLOSE: descendants cannot break away and all die with the container."
      },
      "HandleInheritanceMode": {
        "title": "HandleInheritanceMode",
        "type": "string",
        "enum": [
          "NONE",
          "EXPLICIT_ONLY"
        ],
        "description": "Ambient inheritance is deliberately absent from this enum. W1 proved inherited handles bypass filesystem confinement (probe X03), so it is unrepresentable by construction."
      },
      "EnvironmentMode": {
        "title": "EnvironmentMode",
        "type": "string",
        "enum": [
          "EXPLICIT_ONLY",
          "INHERITED"
        ],
        "description": "EXPLICIT_ONLY: the environment block is constructed, not inherited."
      },
      "ExecutionRequirements": {
        "title": "ExecutionRequirements",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "confinement",
          "filesystem_scope",
          "process_tree",
          "network",
          "handle_inheritance",
          "environment"
        ],
        "properties": {
          "confinement": {
            "type": "string",
            "enum": [
              "NONE",
              "CONFINED"
            ]
          },
          "filesystem_scope": {
            "$ref": "#/$defs/FilesystemScope"
          },
          "process_tree": {
            "$ref": "#/$defs/ProcessTreeMode"
          },
          "network": {
            "$ref": "#/$defs/NetworkRequirement"
          },
          "handle_inheritance": {
            "$ref": "#/$defs/HandleInheritanceMode"
          },
          "environment": {
            "$ref": "#/$defs/EnvironmentMode"
          },
          "granted_paths": {
            "type": "array",
            "maxItems": 64,
            "items": {
              "$ref": "./effect.schema.json#/$defs/ResourceRef"
            },
            "description": "Required when filesystem_scope is EXPLICIT_GRANT; forbidden otherwise."
          },
          "allowed_destinations": {
            "type": "array",
            "maxItems": 64,
            "items": {
              "$ref": "./effect.schema.json#/$defs/NetworkDestination"
            },
            "description": "Required when network is BROKERED_EGRESS; forbidden otherwise."
          },
          "max_wall_clock_ms": {
            "type": "integer",
            "minimum": 1,
            "maximum": 86400000
          },
          "max_output_bytes": {
            "type": "integer",
            "minimum": 1,
            "maximum": 1073741824
          }
        },
        "allOf": [
          {
            "$comment": "التنفيذ المحصور يفرض شجرة عمليات محصورة وبيئة ووراثة مقابض صريحة.",
            "if": {
              "type": "object",
              "properties": {
                "confinement": {
                  "const": "CONFINED"
                }
              },
              "required": [
                "confinement"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "process_tree": {
                  "const": "CONFINED_KILL_ON_CLOSE"
                },
                "environment": {
                  "const": "EXPLICIT_ONLY"
                },
                "filesystem_scope": {
                  "enum": [
                    "NONE",
                    "EXPLICIT_GRANT"
                  ]
                }
              }
            }
          },
          {
            "if": {
              "type": "object",
              "properties": {
                "filesystem_scope": {
                  "const": "EXPLICIT_GRANT"
                }
              },
              "required": [
                "filesystem_scope"
              ]
            },
            "then": {
              "type": "object",
              "required": [
                "granted_paths"
              ],
              "properties": {
                "granted_paths": {
                  "type": "array",
                  "minItems": 1
                }
              }
            },
            "else": {
              "not": {
                "type": "object",
                "required": [
                  "granted_paths"
                ]
              }
            }
          },
          {
            "if": {
              "type": "object",
              "properties": {
                "network": {
                  "const": "BROKERED_EGRESS"
                }
              },
              "required": [
                "network"
              ]
            },
            "then": {
              "type": "object",
              "required": [
                "allowed_destinations"
              ],
              "properties": {
                "allowed_destinations": {
                  "type": "array",
                  "minItems": 1
                }
              }
            },
            "else": {
              "not": {
                "type": "object",
                "required": [
                  "allowed_destinations"
                ]
              }
            }
          }
        ]
      }
    }
  } as unknown as SchemaDocument,
  "common/idempotency.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "PolarisIdempotency",
    "description": "Explicit delivery semantics. POLARIS never claims exactly-once.",
    "$comment": "لا ندّعي Exactly Once. الدلالة تُعلن صراحة لكل قدرة.",
    "$defs": {
      "IdempotencySemantics": {
        "title": "IdempotencySemantics",
        "type": "string",
        "enum": [
          "AT_MOST_ONCE_LOCAL",
          "AT_LEAST_ONCE",
          "PROVIDER_IDEMPOTENT",
          "BEST_EFFORT",
          "UNKNOWN"
        ],
        "description": "UNKNOWN is a valid, honest answer and forbids automatic retry of a side-effecting capability."
      },
      "IdempotencySpec": {
        "title": "IdempotencySpec",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "semantics",
          "retry_safe"
        ],
        "properties": {
          "semantics": {
            "$ref": "#/$defs/IdempotencySemantics"
          },
          "retry_safe": {
            "type": "boolean",
            "description": "Whether the runtime may retry without operator confirmation."
          },
          "key_derivation": {
            "type": "string",
            "enum": [
              "CALLER_SUPPLIED",
              "ARGUMENT_DIGEST"
            ],
            "description": "How the idempotency key for an invocation of this capability is produced."
          }
        },
        "allOf": [
          {
            "$comment": "الدلالة المجهولة أو at-least-once لا تكون آمنة لإعادة المحاولة تلقائيًا.",
            "if": {
              "type": "object",
              "properties": {
                "semantics": {
                  "enum": [
                    "UNKNOWN",
                    "AT_LEAST_ONCE"
                  ]
                }
              },
              "required": [
                "semantics"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "retry_safe": {
                  "const": false
                }
              }
            }
          }
        ]
      }
    }
  } as unknown as SchemaDocument,
  "common/ids.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "PolarisIdPrimitives",
    "description": "Identifier and time primitives shared by all POLARIS core contracts.",
    "$comment": "بدائل المعرفات المشتركة. UUID فقط لمنع المعرفات الحرة غير القابلة للتتبع.",
    "$defs": {
      "Uuid": {
        "title": "Uuid",
        "type": "string",
        "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
        "description": "Lowercase RFC 4122 UUID. Uppercase and non-UUID identifiers are rejected."
      },
      "CorrelationId": {
        "title": "CorrelationId",
        "$ref": "#/$defs/Uuid",
        "description": "Stable identifier for one end-to-end causal chain: IPC -> Invocation -> Decision -> Audit."
      },
      "CausationId": {
        "title": "CausationId",
        "$ref": "#/$defs/Uuid",
        "description": "Identifier of the immediately preceding message that caused this one."
      },
      "IdempotencyKey": {
        "title": "IdempotencyKey",
        "type": "string",
        "pattern": "^[A-Za-z0-9._:-]{16,128}$",
        "description": "Stable across retries of the same logical operation. Never changes when `attempt` changes."
      },
      "SemVer": {
        "title": "SemVer",
        "type": "string",
        "pattern": "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$",
        "description": "Exact three-part semantic version. Ranges are not permitted in contract payloads."
      },
      "ContractVersion": {
        "title": "ContractVersion",
        "type": "string",
        "pattern": "^[1-9][0-9]*\\.(0|[1-9][0-9]*)$",
        "description": "MAJOR.MINOR contract version. Consumers reject unknown MAJOR and unknown-higher MINOR."
      },
      "Timestamp": {
        "title": "Timestamp",
        "type": "string",
        "format": "date-time",
        "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{1,9})?Z$",
        "description": "RFC 3339 instant, UTC only, trailing 'Z' required. Local offsets are rejected so ordering is total and canonicalisation is stable."
      },
      "Sha256Hex": {
        "title": "Sha256Hex",
        "type": "string",
        "pattern": "^[0-9a-f]{64}$",
        "description": "Lowercase hex SHA-256 digest."
      },
      "Slug": {
        "title": "Slug",
        "type": "string",
        "pattern": "^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$",
        "maxLength": 128,
        "description": "Lowercase namespaced identifier used for capability and policy names."
      }
    }
  } as unknown as SchemaDocument,
  "common/provenance.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "PolarisProvenance",
    "description": "Taint labels, provenance references and integrity metadata.",
    "$comment": "أساس Truth/Provenance المستقبلي. W2 يعرّف التمثيل فقط، لا يبني السلسلة.",
    "$defs": {
      "TaintLabel": {
        "title": "TaintLabel",
        "type": "string",
        "enum": [
          "UNTRUSTED_WEB",
          "UNTRUSTED_EMAIL",
          "UNTRUSTED_FILE",
          "MODEL_GENERATED",
          "USER_SUPPLIED",
          "SYSTEM_DERIVED"
        ],
        "description": "Data lineage marker. Propagated, never silently cleared."
      },
      "ProvenanceRef": {
        "title": "ProvenanceRef",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "kind",
          "ref"
        ],
        "properties": {
          "kind": {
            "type": "string",
            "enum": [
              "AUDIT_EVENT",
              "MODEL_OUTPUT",
              "CAPABILITY_RESULT",
              "USER_INPUT"
            ]
          },
          "ref": {
            "$ref": "./ids.schema.json#/$defs/Uuid"
          }
        }
      },
      "Integrity": {
        "title": "Integrity",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "canonicalization",
          "hash_alg",
          "hash"
        ],
        "properties": {
          "canonicalization": {
            "type": "string",
            "const": "POLARIS-CJSON-1",
            "description": "Deterministic JSON canonicalisation: UTF-8, lexicographic key order by UTF-16 code unit, no insignificant whitespace, integers without exponent."
          },
          "hash_alg": {
            "type": "string",
            "const": "SHA-256"
          },
          "hash": {
            "$ref": "./ids.schema.json#/$defs/Sha256Hex"
          },
          "prev_hash": {
            "$ref": "./ids.schema.json#/$defs/Sha256Hex",
            "description": "Reserved for the audit hash chain. W2 defines the field; it builds no chain."
          }
        }
      }
    }
  } as unknown as SchemaDocument,
  "desktop-availability.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "PolarisDesktopAvailability",
    "description": "The one availability model every Phase-01 surface uses. A feature that is not built yet is a first-class state with a machine reason, never an empty screen and never free text.",
    "$comment": "نموذج الإتاحة الوحيد. الحالة والسبب رمزان مغلقان، والنصّ المعروض تُوطّنه الواجهة من الرمز. لا سبب حرّ يحمل سلطة.",
    "$defs": {
      "AvailabilityState": {
        "title": "AvailabilityState",
        "type": "string",
        "enum": [
          "AVAILABLE",
          "READ_ONLY",
          "UNAVAILABLE",
          "BLOCKED",
          "ERROR"
        ],
        "description": "Closed availability state. AVAILABLE means usable now; READ_ONLY means observable but not actionable; UNAVAILABLE means absent by design in this phase; BLOCKED means a prerequisite is unmet; ERROR means the host could not determine it."
      },
      "AvailabilityReason": {
        "title": "AvailabilityReason",
        "type": "string",
        "enum": [
          "PHASE_NOT_IMPLEMENTED",
          "PROVIDER_NOT_CONFIGURED",
          "PLATFORM_UNSUPPORTED",
          "POLICY_DISABLED",
          "RUNTIME_UNAVAILABLE"
        ],
        "description": "Closed machine reason. The UI localises display text from state + reason; localized prose never enters the contract."
      },
      "Availability": {
        "title": "Availability",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "state"
        ],
        "properties": {
          "state": {
            "$ref": "#/$defs/AvailabilityState"
          },
          "reason": {
            "$ref": "#/$defs/AvailabilityReason"
          }
        },
        "allOf": [
          {
            "$comment": "المتاح لا يحمل سببًا: سبب على AVAILABLE يجعل الحقل زخرفة ويُغري الواجهة بعرضه.",
            "if": {
              "type": "object",
              "properties": {
                "state": {
                  "const": "AVAILABLE"
                }
              },
              "required": [
                "state"
              ]
            },
            "then": {
              "not": {
                "type": "object",
                "required": [
                  "reason"
                ]
              }
            }
          },
          {
            "$comment": "كل حالة غير AVAILABLE توجب سببًا مصنّفًا. «غير متاح» بلا سبب هو شاشة فارغة بلغة أخرى.",
            "if": {
              "type": "object",
              "properties": {
                "state": {
                  "enum": [
                    "READ_ONLY",
                    "UNAVAILABLE",
                    "BLOCKED",
                    "ERROR"
                  ]
                }
              },
              "required": [
                "state"
              ]
            },
            "then": {
              "type": "object",
              "required": [
                "reason"
              ]
            }
          }
        ],
        "description": "A state, and a machine reason whenever the state is not AVAILABLE."
      },
      "CapabilityAvailability": {
        "title": "CapabilityAvailability",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "capability_id",
          "availability"
        ],
        "properties": {
          "capability_id": {
            "$ref": "./common/ids.schema.json#/$defs/Slug"
          },
          "availability": {
            "$ref": "#/$defs/Availability"
          }
        },
        "description": "Availability of one capability, as the host determined it. The renderer never computes this from a build-time constant."
      }
    }
  } as unknown as SchemaDocument,
  "desktop-bootstrap.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "PolarisDesktopBootstrapPrimitives",
    "description": "The shell facts the renderer needs before it can draw anything, and nothing else. Every member is bounded; there is no free-form configuration object and no path into host internals.",
    "$comment": "حقائق القشرة وحدها. ما ليس مطلوبًا للرسم لا يعبر الحدّ: لا أسرار، ولا مسارات، ولا داخليات سياسة، ولا مقابض أصلية.",
    "$defs": {
      "BuildChannel": {
        "title": "BuildChannel",
        "type": "string",
        "enum": [
          "DEV",
          "BETA",
          "STABLE"
        ],
        "description": "Release channel of this build."
      },
      "Platform": {
        "title": "Platform",
        "type": "string",
        "enum": [
          "WINDOWS",
          "MACOS"
        ],
        "description": "Host platform. MACOS is representable because the host is cross-platform by construction; Phase-01 measures and claims WINDOWS only."
      },
      "Architecture": {
        "title": "Architecture",
        "type": "string",
        "enum": [
          "X64",
          "ARM64"
        ],
        "description": "Host processor architecture."
      },
      "Locale": {
        "title": "Locale",
        "type": "string",
        "enum": [
          "ar",
          "en",
          "de",
          "fr",
          "ru",
          "zh",
          "ko",
          "ja",
          "es"
        ],
        "description": "The nine architectural locales. Phase-01 proves ar and en; the other seven resolve through fallback and are still representable so that adding one is a resource change, not a contract change."
      },
      "Direction": {
        "title": "Direction",
        "type": "string",
        "enum": [
          "RTL",
          "LTR"
        ],
        "description": "Writing direction. Derived by the host from the locale, never from a manual toggle."
      },
      "Appearance": {
        "title": "Appearance",
        "type": "string",
        "enum": [
          "LIGHT",
          "DARK",
          "SYSTEM"
        ],
        "description": "Resolved appearance preference. SYSTEM means the host defers to the operating system setting."
      },
      "RuntimeReachability": {
        "title": "RuntimeReachability",
        "type": "string",
        "enum": [
          "ATTACHED",
          "NOT_ATTACHED",
          "UNREACHABLE"
        ],
        "description": "Whether the trusted POLARIS core is attached to this host. In Phase-01 the honest value is NOT_ATTACHED: the seam is drawn and left unbuilt, and the shell says so rather than implying a running core."
      },
      "RuntimeStatus": {
        "title": "RuntimeStatus",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "reachability",
          "availability"
        ],
        "properties": {
          "reachability": {
            "$ref": "#/$defs/RuntimeReachability"
          },
          "availability": {
            "$ref": "./desktop-availability.schema.json#/$defs/Availability"
          },
          "runtime_contract_version": {
            "$ref": "./common/ids.schema.json#/$defs/ContractVersion",
            "description": "Present only when a runtime is actually attached and declared its contract version. Absent is honest; an invented version is not."
          }
        },
        "description": "Runtime reachability and posture. Facts only: no process id, no path, no environment, no stack trace."
      },
      "BootstrapSnapshot": {
        "title": "BootstrapSnapshot",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "app_version",
          "build_channel",
          "platform",
          "architecture",
          "locale",
          "direction",
          "appearance",
          "runtime_status",
          "enabled_capabilities",
          "unavailable_capabilities",
          "settings_schema_version",
          "ipc_protocol_version"
        ],
        "properties": {
          "app_version": {
            "$ref": "./common/ids.schema.json#/$defs/SemVer"
          },
          "build_channel": {
            "$ref": "#/$defs/BuildChannel"
          },
          "platform": {
            "$ref": "#/$defs/Platform"
          },
          "architecture": {
            "$ref": "#/$defs/Architecture"
          },
          "locale": {
            "$ref": "#/$defs/Locale"
          },
          "direction": {
            "$ref": "#/$defs/Direction"
          },
          "appearance": {
            "$ref": "#/$defs/Appearance"
          },
          "runtime_status": {
            "$ref": "#/$defs/RuntimeStatus"
          },
          "enabled_capabilities": {
            "type": "array",
            "maxItems": 128,
            "uniqueItems": true,
            "items": {
              "$ref": "./common/ids.schema.json#/$defs/Slug"
            },
            "description": "Capabilities the host will actually answer for right now. An empty array is a valid and honest answer."
          },
          "unavailable_capabilities": {
            "type": "array",
            "maxItems": 128,
            "items": {
              "$ref": "./desktop-availability.schema.json#/$defs/CapabilityAvailability"
            },
            "description": "Everything the shell can name but cannot use, each with a state and a machine reason."
          },
          "settings_schema_version": {
            "$ref": "./common/ids.schema.json#/$defs/ContractVersion"
          },
          "ipc_protocol_version": {
            "$ref": "./common/ids.schema.json#/$defs/ContractVersion"
          }
        },
        "description": "The complete Phase-01 bootstrap fact set. additionalProperties is false, so a host that grows a new fact must change this contract in the open."
      }
    }
  } as unknown as SchemaDocument,
  "desktop-error-mapping.v1.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "DesktopErrorMappingV1",
    "description": "How the frozen POLARIS error vocabulary becomes a UI-facing category, and what is allowed to cross the trust boundary with it. This is a mapping over the existing vocabulary, never a second error universe.",
    "$comment": "لا كون أخطاء ثانٍ. الفئة المعروضة مشتقة من ErrorCode المجمَّد، والاشتقاق مُصرَّح به هنا ويُفحص باختبار اكتمال: رمز قانوني بلا فئة عيبٌ يُوقف البناء.",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "contract_version",
      "phase",
      "entries"
    ],
    "properties": {
      "contract_version": {
        "$ref": "./common/ids.schema.json#/$defs/ContractVersion"
      },
      "phase": {
        "type": "string",
        "enum": [
          "PHASE-01"
        ]
      },
      "entries": {
        "type": "array",
        "minItems": 1,
        "maxItems": 32,
        "items": {
          "$ref": "#/$defs/DesktopErrorMappingEntry"
        }
      }
    },
    "$defs": {
      "DesktopErrorCategory": {
        "title": "DesktopErrorCategory",
        "type": "string",
        "enum": [
          "IPC_UNAVAILABLE",
          "IPC_TIMEOUT",
          "UNSUPPORTED_OPERATION",
          "INVALID_RESPONSE",
          "NATIVE_SERVICE_UNAVAILABLE",
          "CONFIG_UNAVAILABLE",
          "PERMISSION_DENIED",
          "FEATURE_NOT_AVAILABLE",
          "INTERNAL_ERROR"
        ],
        "description": "The nine categories a Phase-01 screen may render. Closed: a tenth category is a contract change, not a string a component invents."
      },
      "Redaction": {
        "title": "Redaction",
        "type": "string",
        "enum": [
          "STRIP_INTERNAL_DETAIL",
          "STRIP_ALL_DETAIL"
        ],
        "description": "Default redaction applied before an error crosses to the renderer. STRIP_INTERNAL_DETAIL removes internal_detail and keeps the JSON pointer; STRIP_ALL_DETAIL removes both, for errors whose pointer would itself describe host internals."
      },
      "DesktopErrorMappingEntry": {
        "title": "DesktopErrorMappingEntry",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "category",
          "canonical_codes",
          "retryable",
          "detail_may_cross_boundary",
          "default_redaction",
          "display_key"
        ],
        "properties": {
          "category": {
            "$ref": "#/$defs/DesktopErrorCategory"
          },
          "canonical_codes": {
            "type": "array",
            "minItems": 1,
            "maxItems": 9,
            "uniqueItems": true,
            "items": {
              "$ref": "./common/error.schema.json#/$defs/ErrorCode"
            },
            "description": "The frozen error codes that produce this category. The union over all entries must cover the whole vocabulary; a completeness test proves it."
          },
          "retryable": {
            "type": "boolean",
            "description": "Whether the shell may offer a retry. A retry offered for a permanent failure teaches the user to distrust the button."
          },
          "detail_may_cross_boundary": {
            "type": "boolean",
            "description": "Whether internal_detail may reach the renderer. In Phase-01 this is false for every entry; a trusted diagnostics path is a later phase and would have to flip this in the open."
          },
          "default_redaction": {
            "$ref": "#/$defs/Redaction"
          },
          "display_key": {
            "$ref": "./desktop-settings.schema.json#/$defs/DisplayKey",
            "description": "Localization key for the message shown. The contract carries no prose."
          }
        }
      },
      "DesktopErrorView": {
        "title": "DesktopErrorView",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "category",
          "code",
          "display_message",
          "retryable"
        ],
        "properties": {
          "category": {
            "$ref": "#/$defs/DesktopErrorCategory"
          },
          "code": {
            "$ref": "./common/error.schema.json#/$defs/ErrorCode"
          },
          "display_message": {
            "type": "string",
            "minLength": 1,
            "maxLength": 512
          },
          "retryable": {
            "type": "boolean"
          },
          "correlation_id": {
            "$ref": "./common/ids.schema.json#/$defs/CorrelationId",
            "description": "So a user-visible failure can be found in the host log without the host log crossing the boundary."
          },
          "pointer": {
            "type": "string",
            "maxLength": 512,
            "description": "Present only when the entry's redaction keeps it."
          }
        },
        "description": "Exactly what an error looks like on the renderer side. There is no internal_detail member and no stack member: they are unrepresentable here, not merely omitted by convention."
      }
    }
  } as unknown as SchemaDocument,
  "desktop-ipc-registry.v1.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "DesktopIpcRegistryV1",
    "description": "An authoritative desktop IPC registry for one phase: one record per operation, naming its schemas, its owning native service, its effect, its trust boundary, its caller class, its error categories and its routing status. The native gateway is built from these documents; they are not a second description of it.",
    "$comment": "السجل ليس توجيهًا. هو ما يُبنى منه التوجيه لاحقًا، والفصل مقصود: صحة المخطط لا تعني الإذن بالتوجيه، وهذه الوثيقة هي المكان الذي يُصرَّح فيه بالفرق.",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "contract_version",
      "phase",
      "envelope_contract",
      "implementation_status",
      "operations"
    ],
    "properties": {
      "contract_version": {
        "$ref": "./common/ids.schema.json#/$defs/ContractVersion"
      },
      "phase": {
        "type": "string",
        "enum": [
          "PHASE-01",
          "PHASE-02",
          "PHASE-03",
          "PHASE-04",
          "PHASE-05",
          "PHASE-06",
          "PHASE-08"
        ]
      },
      "envelope_contract": {
        "type": "string",
        "enum": [
          "IPCEnvelopeV1"
        ],
        "description": "The one envelope these operations travel in. A second envelope contract would be visible here as a second value; there is none."
      },
      "implementation_status": {
        "type": "string",
        "enum": [
          "SPECIFIED",
          "IMPLEMENTED"
        ],
        "description": "SPECIFIED means this document states what the gateway must do and no gateway exists yet — the state P01-W2 leaves it in. IMPLEMENTED is P01-W3's to set, once a host actually routes these operations. The field exists so that a specification cannot be read as a measurement."
      },
      "operations": {
        "type": "array",
        "minItems": 1,
        "maxItems": 64,
        "items": {
          "$ref": "#/$defs/DesktopOperationRecord"
        }
      }
    },
    "$defs": {
      "RoutingStatus": {
        "title": "RoutingStatus",
        "type": "string",
        "enum": [
          "ROUTED",
          "NOT_ROUTED"
        ],
        "description": "Whether the gateway will dispatch the operation at all. A schema-valid operation whose record says NOT_ROUTED is refused with UNSUPPORTED_OPERATION; validity is not authorisation."
      },
      "DesktopOperationRecord": {
        "title": "DesktopOperationRecord",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "operation",
          "envelope_version",
          "request_schema",
          "response_schema",
          "owner",
          "effect",
          "idempotency",
          "trust_boundary",
          "caller_class",
          "caller_identity_authority",
          "error_categories",
          "availability",
          "routing_status",
          "phase_introduced"
        ],
        "properties": {
          "operation": {
            "anyOf": [
              {
                "$ref": "./desktop-operation.schema.json#/$defs/Phase01DesktopOperation"
              },
              {
                "$ref": "./desktop-operation.schema.json#/$defs/Phase02DesktopOperation"
              },
              {
                "$ref": "./desktop-operation.schema.json#/$defs/Phase03DesktopOperation"
              },
              {
                "$ref": "./desktop-operation.schema.json#/$defs/Phase04DesktopOperation"
              },
              {
                "$ref": "./desktop-operation.schema.json#/$defs/Phase05DesktopOperation"
              },
              {
                "$ref": "./desktop-operation.schema.json#/$defs/Phase06DesktopOperation"
              },
              {
                "$ref": "./desktop-operation.schema.json#/$defs/Phase08DesktopOperation"
              }
            ]
          },
          "envelope_version": {
            "$ref": "./common/ids.schema.json#/$defs/ContractVersion",
            "description": "The IPCEnvelopeV1 version that introduced the operation."
          },
          "request_schema": {
            "$ref": "./desktop-operation.schema.json#/$defs/SchemaReference"
          },
          "response_schema": {
            "$ref": "./desktop-operation.schema.json#/$defs/SchemaReference"
          },
          "owner": {
            "$ref": "./desktop-operation.schema.json#/$defs/OwningService"
          },
          "effect": {
            "$ref": "./desktop-operation.schema.json#/$defs/OperationEffect"
          },
          "effect_class": {
            "$ref": "./desktop-operation.schema.json#/$defs/EffectClass",
            "description": "The finer effect class. Mandatory from Phase-02; absent on Phase-01 records, which are all READ_ONLY."
          },
          "idempotency": {
            "$ref": "./desktop-operation.schema.json#/$defs/IdempotencyRequirement"
          },
          "trust_boundary": {
            "$ref": "./desktop-operation.schema.json#/$defs/TrustBoundary"
          },
          "caller_class": {
            "$ref": "./desktop-operation.schema.json#/$defs/CallerClass"
          },
          "caller_identity_authority": {
            "$ref": "./desktop-operation.schema.json#/$defs/CallerIdentityAuthority"
          },
          "error_categories": {
            "type": "array",
            "minItems": 1,
            "maxItems": 9,
            "uniqueItems": true,
            "items": {
              "$ref": "./desktop-error-mapping.v1.schema.json#/$defs/DesktopErrorCategory"
            },
            "description": "The categories this operation may produce. An operation that could return anything would list all nine, which is itself a reviewable claim."
          },
          "availability": {
            "$ref": "./desktop-availability.schema.json#/$defs/Availability",
            "description": "Availability of the operation itself, using the one availability model rather than a private flag."
          },
          "routing_status": {
            "$ref": "#/$defs/RoutingStatus"
          },
          "phase_introduced": {
            "type": "string",
            "enum": [
              "PHASE-01",
              "PHASE-02",
              "PHASE-03",
              "PHASE-04",
              "PHASE-05",
              "PHASE-06",
              "PHASE-08"
            ]
          }
        },
        "allOf": [
          {
            "$comment": "عملية بلا أثر جانبي لا تطلب مفتاح Idempotency. الشرط مكتوب حتى لا يُصنَّف شيء READ_ONLY ثم يُطلب له مفتاح.",
            "if": {
              "type": "object",
              "properties": {
                "effect": {
                  "const": "READ_ONLY"
                }
              },
              "required": [
                "effect"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "idempotency": {
                  "const": "NOT_REQUIRED"
                }
              }
            }
          },
          {
            "$comment": "عملية ذات أثر جانبي تطلب مفتاح Idempotency دائمًا.",
            "if": {
              "type": "object",
              "properties": {
                "effect": {
                  "const": "SIDE_EFFECTING"
                }
              },
              "required": [
                "effect"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "idempotency": {
                  "const": "REQUIRED"
                }
              }
            }
          },
          {
            "$comment": "عملية Phase-01 تسافر في 1.1 وتنتمي إلى مجموعتها وحدها.",
            "if": {
              "type": "object",
              "properties": {
                "phase_introduced": {
                  "const": "PHASE-01"
                }
              },
              "required": [
                "phase_introduced"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "envelope_version": {
                  "const": "1.1"
                },
                "operation": {
                  "$ref": "./desktop-operation.schema.json#/$defs/Phase01DesktopOperation"
                }
              }
            }
          },
          {
            "$comment": "عملية Phase-02 تحمل صنف أثر، وتسافر في 1.2، وتنتمي إلى مجموعتها وحدها.",
            "if": {
              "type": "object",
              "properties": {
                "phase_introduced": {
                  "const": "PHASE-02"
                }
              },
              "required": [
                "phase_introduced"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "envelope_version": {
                  "const": "1.2"
                },
                "operation": {
                  "$ref": "./desktop-operation.schema.json#/$defs/Phase02DesktopOperation"
                }
              },
              "required": [
                "effect_class"
              ]
            }
          },
          {
            "$comment": "عملية Phase-03 تحمل صنف أثر، وتسافر في 1.3، وتنتمي إلى مجموعتها وحدها.",
            "if": {
              "type": "object",
              "properties": {
                "phase_introduced": {
                  "const": "PHASE-03"
                }
              },
              "required": [
                "phase_introduced"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "envelope_version": {
                  "const": "1.3"
                },
                "operation": {
                  "$ref": "./desktop-operation.schema.json#/$defs/Phase03DesktopOperation"
                }
              },
              "required": [
                "effect_class"
              ]
            }
          },
          {
            "$comment": "عملية Phase-04 تحمل صنف أثر، وتسافر في 1.4، وتنتمي إلى مجموعتها وحدها.",
            "if": {
              "type": "object",
              "properties": {
                "phase_introduced": {
                  "const": "PHASE-04"
                }
              },
              "required": [
                "phase_introduced"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "envelope_version": {
                  "const": "1.4"
                },
                "operation": {
                  "$ref": "./desktop-operation.schema.json#/$defs/Phase04DesktopOperation"
                }
              },
              "required": [
                "effect_class"
              ]
            }
          },
          {
            "$comment": "عملية Phase-05 تحمل صنف أثر، وتسافر في 1.5، وتنتمي إلى مجموعتها وحدها.",
            "if": {
              "type": "object",
              "properties": {
                "phase_introduced": {
                  "const": "PHASE-05"
                }
              },
              "required": [
                "phase_introduced"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "envelope_version": {
                  "const": "1.5"
                },
                "operation": {
                  "$ref": "./desktop-operation.schema.json#/$defs/Phase05DesktopOperation"
                }
              },
              "required": [
                "effect_class"
              ]
            }
          },
          {
            "$comment": "عملية Phase-08 تحمل صنف أثر، وتسافر في 1.7، وتنتمي إلى مجموعتها وحدها.",
            "if": {
              "type": "object",
              "properties": {
                "phase_introduced": {
                  "const": "PHASE-08"
                }
              },
              "required": [
                "phase_introduced"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "envelope_version": {
                  "const": "1.7"
                },
                "operation": {
                  "$ref": "./desktop-operation.schema.json#/$defs/Phase08DesktopOperation"
                }
              },
              "required": [
                "effect_class"
              ]
            }
          },
          {
            "$comment": "القراءة تعني قراءة: صنف الأثر يطابق التصنيف العام.",
            "if": {
              "type": "object",
              "properties": {
                "effect": {
                  "const": "READ_ONLY"
                }
              },
              "required": [
                "effect",
                "effect_class"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "effect_class": {
                  "enum": [
                    "READ",
                    "READ_RESOURCE"
                  ]
                }
              }
            },
            "else": {
              "type": "object",
              "properties": {
                "effect_class": {
                  "not": {
                    "enum": [
                      "READ",
                      "READ_RESOURCE"
                    ]
                  }
                }
              }
            }
          }
        ]
      }
    }
  } as unknown as SchemaDocument,
  "desktop-operation.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "PolarisDesktopOperationPrimitives",
    "description": "Desktop operation vocabulary: the closed Phase-01 and Phase-02 operation subsets, their effect classification, their caller class and their trust boundary. Shared by the envelope binding, the IPC registries and the error mapping.",
    "$comment": "مفردات عمليات سطح المكتب. المجموعة الفرعية مغلقة كما الأصل مغلق: عملية خارجها غير قابلة للتمثيل لا مرفوضة وقت التشغيل فقط.",
    "$defs": {
      "Phase01DesktopOperation": {
        "title": "Phase01DesktopOperation",
        "type": "string",
        "enum": [
          "desktop.bootstrap",
          "desktop.runtime.status",
          "desktop.capability.availability",
          "desktop.settings.describe",
          "desktop.settings.read"
        ],
        "description": "The five read-only desktop operations added by IPCEnvelopeV1 1.1 (ADR-017). This is a strict subset of IPCEnvelopeV1 Operation; a parity test proves the two never drift."
      },
      "Phase02DesktopOperation": {
        "title": "Phase02DesktopOperation",
        "type": "string",
        "enum": [
          "provider.list",
          "provider.configure",
          "provider.credential.set",
          "provider.credential.clear",
          "provider.refresh",
          "model.list",
          "model.configure",
          "model.preferences.set",
          "model.invoke",
          "model.cancel",
          "project.list",
          "project.get",
          "project.create",
          "project.update",
          "project.archive",
          "context.add",
          "context.remove",
          "context.preview",
          "context.assemble"
        ],
        "description": "The nineteen Phase-02 operations added by IPCEnvelopeV1 1.2 (ADR-019). A strict subset of IPCEnvelopeV1 Operation; a parity test proves the two never drift."
      },
      "OperationEffect": {
        "title": "OperationEffect",
        "type": "string",
        "enum": [
          "READ_ONLY",
          "SIDE_EFFECTING"
        ],
        "description": "Effect classification. Every Phase-01 desktop operation is READ_ONLY. A SIDE_EFFECTING operation enters the idempotency conditional of the envelope in the same change."
      },
      "IdempotencyRequirement": {
        "title": "IdempotencyRequirement",
        "type": "string",
        "enum": [
          "NOT_REQUIRED",
          "REQUIRED"
        ],
        "description": "Whether the envelope must carry idempotency_key. READ_ONLY implies NOT_REQUIRED; the registry test proves the implication holds."
      },
      "TrustBoundary": {
        "title": "TrustBoundary",
        "type": "string",
        "enum": [
          "RENDERER_TO_NATIVE_HOST"
        ],
        "description": "The boundary an operation crosses. Phase-01 has exactly one; naming it makes a second one a visible contract change rather than an accident."
      },
      "CallerClass": {
        "title": "CallerClass",
        "type": "string",
        "enum": [
          "DESKTOP_RENDERER"
        ],
        "description": "Which class of caller may issue the operation. This is the class the native gateway stamps, never a value the renderer asserts. It maps onto the frozen CallerType CORE_UI at the envelope level; the registry names the class, the envelope names the type."
      },
      "CallerIdentityAuthority": {
        "title": "CallerIdentityAuthority",
        "type": "string",
        "enum": [
          "NATIVE_TRANSPORT"
        ],
        "description": "Who decides caller identity for the operation. NATIVE_TRANSPORT means the host stamps identity from the transport and overwrites whatever the renderer asserted."
      },
      "OwningService": {
        "title": "OwningService",
        "type": "string",
        "enum": [
          "BootstrapService",
          "RuntimeStatusService",
          "CapabilityAvailabilityService",
          "SettingsFacade",
          "ProviderRegistryService",
          "ProviderConfigService",
          "SecretBrokerService",
          "ModelDiscoveryService",
          "ModelRegistryService",
          "ModelSelectionService",
          "ModelInvocationService",
          "ProjectService",
          "ContextSourceService",
          "ContextPreviewService",
          "ContextAssemblyService",
          "MissionService",
          "MissionOrchestrationService",
          "TaskGraphService",
          "AgentRuntimeService",
          "ClaimService",
          "EvidenceService",
          "SkillRegistryService",
          "ToolRegistryService",
          "ToolGatewayService",
          "ToolActivityService",
          "McpServerService",
          "McpDiscoveryService",
          "ToolApprovalService",
          "MemoryService",
          "BrowserSessionService",
          "ComputerSessionService",
          "ComputerTargetService",
          "ConnectorService",
          "ConnectorHealthService",
          "ConnectorSecretService",
          "ConnectorImportService",
          "UsageLedgerService",
          "BudgetService",
          "PricingService",
          "ObservabilityService",
          "DiagnosticsService",
          "ConfigControlPlane",
          "WorkspaceService",
          "AttachmentService",
          "ArtifactService",
          "ExecutionService",
          "MissionPreferenceService",
          "ConversationService",
          "SpecialistCatalogService",
          "SchedulerService",
          "OAuthService",
          "VoiceService",
          "ShareService",
          "PublishService",
          "SkillPackageService",
          "DeviceService",
          "IntegrationSettingsService",
          "WebSearchService",
          "GitHubConnectorService"
        ],
        "description": "The single native service that answers the operation. One owner per operation; there is no dispatcher service."
      },
      "SchemaReference": {
        "title": "SchemaReference",
        "type": "string",
        "pattern": "^[a-z0-9][a-z0-9./-]*\\.schema\\.json#/\\$defs/[A-Za-z][A-Za-z0-9]*$",
        "maxLength": 256,
        "description": "A schema file path relative to contracts/schemas, plus a JSON Pointer to the definition inside it. The registry consistency test resolves every reference against the loaded schema set, so a dangling reference fails the build."
      },
      "EffectClass": {
        "title": "EffectClass",
        "type": "string",
        "enum": [
          "READ",
          "READ_RESOURCE",
          "WRITE_CONFIG",
          "SECRET_WRITE",
          "CREATE_LOCAL_DATA",
          "WRITE_LOCAL_DATA",
          "NETWORK_PROBE",
          "MODEL_INVOCATION",
          "CONTROL"
        ],
        "description": "Phase-02 effect class. READ has no side effect; READ_RESOURCE reads a user-authorised local resource; WRITE_CONFIG and SECRET_WRITE change trusted settings or the credential store; CREATE_LOCAL_DATA and WRITE_LOCAL_DATA change the product database; NETWORK_PROBE contacts a provider endpoint; MODEL_INVOCATION sends a request to a model provider; CONTROL changes the state of an in-flight operation. A side effect is never hidden under READ."
      },
      "Phase03DesktopOperation": {
        "title": "Phase03DesktopOperation",
        "type": "string",
        "enum": [
          "mission.list",
          "mission.get",
          "mission.create",
          "mission.start",
          "mission.cancel",
          "mission.resume",
          "task.list",
          "agent.list",
          "claim.list",
          "evidence.list"
        ],
        "description": "The ten Phase-03 operations added by IPCEnvelopeV1 1.3. There is no agent.execute, agent.call or orchestrator.command: an operation whose payload could name an arbitrary action is not in this set and cannot be added to it without changing this contract."
      },
      "Phase04DesktopOperation": {
        "title": "Phase04DesktopOperation",
        "type": "string",
        "enum": [
          "skill.list",
          "skill.get",
          "skill.configure",
          "tool.list",
          "tool.get",
          "tool.activity.list",
          "mcp.list",
          "mcp.register",
          "mcp.configure",
          "mcp.refresh",
          "approval.list",
          "tool.approval.respond"
        ],
        "description": "The twelve Phase-04 operations added by IPCEnvelopeV1 1.4. There is no tool.execute, tool.invoke or mcp.call: the renderer can read the registry and answer an approval, and nothing here can run a tool. Tool invocation has exactly one caller, the trusted mission runtime, and exactly one path, the tool gateway."
      },
      "Phase05DesktopOperation": {
        "title": "Phase05DesktopOperation",
        "type": "string",
        "enum": [
          "memory.list",
          "memory.get",
          "memory.delete",
          "browser.session.list",
          "browser.session.get",
          "browser.session.cancel",
          "computer.session.list",
          "computer.session.get",
          "computer.session.cancel",
          "computer.window.list",
          "computer.target.grant",
          "computer.target.revoke"
        ],
        "description": "The twelve Phase-05 operations added by IPCEnvelopeV1 1.5. There is no browser.raw_execute, computer.raw_command or memory.trust: the renderer can read sessions and memory, delete a memory, grant a window to a mission and stop a session, and nothing here can navigate, click, type or raise the trust of a memory. Browser and computer actions have exactly one caller, the trusted mission runtime, and exactly one path, the tool gateway."
      },
      "Phase06DesktopOperation": {
        "title": "Phase06DesktopOperation",
        "type": "string",
        "enum": [
          "connector.list",
          "connector.get",
          "connector.register",
          "connector.configure",
          "connector.remove",
          "connector.test",
          "connector.credential.set",
          "connector.credential.clear",
          "connector.openapi.import",
          "connector.openapi.approve",
          "connector.preset.list",
          "connector.preset.register",
          "usage.summary",
          "usage.list",
          "budget.list",
          "budget.set",
          "budget.remove",
          "pricing.list",
          "pricing.set",
          "pricing.remove",
          "observability.health",
          "observability.events",
          "observability.metrics",
          "observability.errors",
          "observability.alerts",
          "diagnostics.export",
          "config.describe",
          "config.effective",
          "config.set",
          "config.reset"
        ],
        "description": "The twenty-eight Phase-06 operations added by IPCEnvelopeV1 1.6. There is no connector.invoke, connector.execute or connector.call: the renderer registers, configures, tests and reads connectors, budgets, prices, observability and settings, and nothing here performs a connector operation on a service. Connector operations have exactly one caller, the trusted mission runtime, and exactly one path, the tool gateway and then the connector gateway. No operation reveals a credential value."
      },
      "Phase08DesktopOperation": {
        "title": "Phase08DesktopOperation",
        "type": "string",
        "enum": [
          "workspace.list",
          "workspace.preview",
          "workspace.export",
          "attachment.stage",
          "attachment.discard",
          "attachment.artifact.stage",
          "attachment.list",
          "attachment.bind",
          "artifact.list",
          "artifact.get",
          "execution.status",
          "execution.runs",
          "execution.runtime.prepare",
          "mission.model.set",
          "schedule.list",
          "schedule.save",
          "schedule.enable",
          "schedule.delete",
          "schedule.run_now",
          "oauth.list",
          "oauth.connect",
          "oauth.disconnect",
          "voice.transcribe",
          "share.list",
          "share.set",
          "publish.list",
          "publish.propose",
          "publish.decide",
          "skill.package.list",
          "skill.package.import",
          "device.export",
          "device.import",
          "integration.settings.set",
          "conversation.begin",
          "conversation.continue",
          "conversation.get",
          "conversation.index",
          "agent.catalog",
          "mission.specialist.set",
          "conversation.update",
          "conversation.delete",
          "project.delete",
          "memory.remember",
          "conversation.search",
          "mission.trace",
          "mcp.tool.accept_redefinition",
          "provider.catalog",
          "provider.credential.put",
          "provider.custom.save",
          "provider.custom.delete",
          "web.search.status",
          "web.search.credential.put",
          "web.search.test",
          "mission.rating.set",
          "mission.note.add",
          "tool.approval.grants",
          "tool.approval.grant.revoke",
          "github.status",
          "github.connect",
          "github.disconnect",
          "memory.semantic.status",
          "memory.semantic.set",
          "memory.semantic.test"
        ],
        "description": "The forty-three Phase-08 operations added by IPCEnvelopeV1 1.7 (the four conversation.* members later, ADR-029; agent.catalog and mission.specialist.set later still, ADR-030; conversation.update, conversation.delete and project.delete after them, ADR-031; memory.remember, ADR-032; conversation.search, ADR-031). There is no execution.command, execution.python, workspace.write, browser.execute, oauth.token.get or email.send: the renderer attaches files, reads workspaces, artifacts and runs, edits schedules, connections, grants and settings, and decides what waits for its decision. Commands, Python, browsing and workspace writes have exactly one caller, the trusted mission runtime, and exactly one path, the tool gateway. The ten web.search.*, mission.rating.set, mission.note.add, tool.approval.grants, tool.approval.grant.revoke and github.* members were added additively at 1.7 later still (ADR-042)."
      }
    }
  } as unknown as SchemaDocument,
  "desktop-p02-domain.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "PolarisPhase02Domain",
    "description": "Phase-02 provider, model, project and context vocabulary shared by the Phase-02 request and result payloads. Every object is closed; every unknown fact is representable as UNKNOWN and nothing else.",
    "$comment": "مفردات Phase-02. لا قيمة مخمّنة: كل حقيقة تحمل مصدرها، والمجهول قيمة صريحة.",
    "$defs": {
      "ProviderId": {
        "title": "ProviderId",
        "type": "string",
        "pattern": "^[a-z][a-z0-9-]{1,47}$",
        "description": "Identifier of a registered provider instance. Only ids the host registered are ever routed; an unknown id is refused by the host, not merely absent."
      },
      "ModelId": {
        "title": "ModelId",
        "type": "string",
        "maxLength": 249,
        "pattern": "^[a-z][a-z0-9-]{1,47}:[\\x21\\x23-\\x26\\x28-\\x3b\\x3d\\x3f-\\x5b\\x5d-\\x5f\\x61-\\x7e]{1,200}$",
        "description": "Stable model identity: <provider_id>:<provider_model_id>. Quotes, angle brackets, backslash, backtick and whitespace are unrepresentable."
      },
      "ProviderModelId": {
        "title": "ProviderModelId",
        "type": "string",
        "pattern": "^[\\x21\\x23-\\x26\\x28-\\x3b\\x3d\\x3f-\\x5b\\x5d-\\x5f\\x61-\\x7e]{1,200}$",
        "description": "The identifier the provider itself uses."
      },
      "Provenance": {
        "title": "Provenance",
        "type": "string",
        "enum": [
          "PROVIDER_REPORTED",
          "LOCALLY_MEASURED",
          "STATIC_DESCRIPTOR",
          "ESTIMATED",
          "UNKNOWN"
        ],
        "description": "Where a fact comes from. An estimated or reported value is never presented as measured."
      },
      "Support": {
        "title": "Support",
        "type": "string",
        "enum": [
          "SUPPORTED",
          "UNSUPPORTED",
          "UNKNOWN"
        ],
        "description": "UNKNOWN is a first-class answer and is never treated as SUPPORTED."
      },
      "CapabilityClaim": {
        "title": "CapabilityClaim",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "support",
          "provenance"
        ],
        "properties": {
          "support": {
            "$ref": "#/$defs/Support"
          },
          "provenance": {
            "$ref": "#/$defs/Provenance"
          }
        },
        "allOf": [
          {
            "$comment": "مدعوم أو غير مدعوم بلا مصدر ادعاءٌ بلا دليل، والمجهول لا مصدر له.",
            "if": {
              "type": "object",
              "properties": {
                "support": {
                  "const": "UNKNOWN"
                }
              },
              "required": [
                "support"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "provenance": {
                  "const": "UNKNOWN"
                }
              }
            },
            "else": {
              "type": "object",
              "properties": {
                "provenance": {
                  "not": {
                    "const": "UNKNOWN"
                  }
                }
              }
            }
          }
        ]
      },
      "FactInteger": {
        "title": "FactInteger",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "provenance"
        ],
        "properties": {
          "value": {
            "type": "integer",
            "minimum": 0,
            "maximum": 100000000000
          },
          "provenance": {
            "$ref": "#/$defs/Provenance"
          }
        },
        "allOf": [
          {
            "$comment": "قيمة بلا مصدر معروف غير قابلة للتمثيل، والمجهول لا يحمل قيمة.",
            "if": {
              "type": "object",
              "required": [
                "value"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "provenance": {
                  "not": {
                    "const": "UNKNOWN"
                  }
                }
              }
            },
            "else": {
              "type": "object",
              "properties": {
                "provenance": {
                  "const": "UNKNOWN"
                }
              }
            }
          }
        ]
      },
      "FactText": {
        "title": "FactText",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "provenance"
        ],
        "properties": {
          "value": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "pattern": "^[^\\u0000-\\u001f\\u007f]*$"
          },
          "provenance": {
            "$ref": "#/$defs/Provenance"
          }
        },
        "allOf": [
          {
            "$comment": "قيمة بلا مصدر معروف غير قابلة للتمثيل، والمجهول لا يحمل قيمة.",
            "if": {
              "type": "object",
              "required": [
                "value"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "provenance": {
                  "not": {
                    "const": "UNKNOWN"
                  }
                }
              }
            },
            "else": {
              "type": "object",
              "properties": {
                "provenance": {
                  "const": "UNKNOWN"
                }
              }
            }
          }
        ]
      },
      "ProviderKind": {
        "title": "ProviderKind",
        "type": "string",
        "enum": [
          "LOCAL_OPENAI_COMPATIBLE",
          "OLLAMA",
          "LM_STUDIO",
          "OPENAI",
          "ANTHROPIC",
          "GOOGLE",
          "OPENROUTER",
          "OPENAI_COMPATIBLE_API",
          "CUSTOM_OPENAI_COMPATIBLE",
          "CLAUDE_CLI",
          "CODEX_CLI"
        ],
        "description": "Closed provider classes. A new class is an explicit registration, not a string. OPENAI_COMPATIBLE_API and CUSTOM_OPENAI_COMPATIBLE were added by ADR-037. CLAUDE_CLI and CODEX_CLI (2026-11-12) reach a remote model through a command-line tool installed on this computer."
      },
      "Locality": {
        "title": "Locality",
        "type": "string",
        "enum": [
          "LOCAL",
          "REMOTE"
        ],
        "description": "Whether requests leave this computer."
      },
      "AuthMode": {
        "title": "AuthMode",
        "type": "string",
        "enum": [
          "NO_AUTH_LOCAL",
          "API_KEY",
          "OPTIONAL_API_KEY",
          "CLI_LOGIN"
        ],
        "description": "Only officially supported authentication. OAuth is not modelled until a provider offers a supported desktop flow. CLI_LOGIN: the command-line tool holds its own sign-in; the host never reads or stores a credential for it."
      },
      "EndpointType": {
        "title": "EndpointType",
        "type": "string",
        "enum": [
          "OPENAI_COMPATIBLE",
          "OLLAMA_NATIVE",
          "ANTHROPIC_MESSAGES",
          "GOOGLE_GENERATIVE_LANGUAGE",
          "LOCAL_CLI"
        ],
        "description": "Protocol family. LOCAL_CLI: a local command-line process that makes the remote connection itself."
      },
      "NetworkClass": {
        "title": "NetworkClass",
        "type": "string",
        "enum": [
          "LOOPBACK_PROVIDER_ACCESS",
          "REMOTE_EGRESS"
        ],
        "description": "LOOPBACK_PROVIDER_ACCESS reaches 127.0.0.1 or ::1 only. REMOTE_EGRESS reaches the provider's fixed https host only."
      },
      "ProviderCapabilities": {
        "title": "ProviderCapabilities",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "supports_streaming",
          "supports_model_listing",
          "supports_health_check",
          "supports_chat",
          "supports_embeddings",
          "supports_vision",
          "supports_audio_input",
          "supports_audio_output",
          "supports_tools",
          "supports_json_schema",
          "supports_system_prompt",
          "supports_reasoning_control"
        ],
        "properties": {
          "supports_streaming": {
            "$ref": "#/$defs/CapabilityClaim"
          },
          "supports_model_listing": {
            "$ref": "#/$defs/CapabilityClaim"
          },
          "supports_health_check": {
            "$ref": "#/$defs/CapabilityClaim"
          },
          "supports_chat": {
            "$ref": "#/$defs/CapabilityClaim"
          },
          "supports_embeddings": {
            "$ref": "#/$defs/CapabilityClaim"
          },
          "supports_vision": {
            "$ref": "#/$defs/CapabilityClaim"
          },
          "supports_audio_input": {
            "$ref": "#/$defs/CapabilityClaim"
          },
          "supports_audio_output": {
            "$ref": "#/$defs/CapabilityClaim"
          },
          "supports_tools": {
            "$ref": "#/$defs/CapabilityClaim"
          },
          "supports_json_schema": {
            "$ref": "#/$defs/CapabilityClaim"
          },
          "supports_system_prompt": {
            "$ref": "#/$defs/CapabilityClaim"
          },
          "supports_reasoning_control": {
            "$ref": "#/$defs/CapabilityClaim"
          }
        },
        "description": "Protocol-level capabilities. Per-model capabilities are read from the model."
      },
      "HealthState": {
        "title": "HealthState",
        "type": "string",
        "enum": [
          "HEALTHY",
          "DEGRADED",
          "UNREACHABLE",
          "AUTH_REQUIRED",
          "AUTH_FAILED",
          "RATE_LIMITED",
          "MISCONFIGURED",
          "UNKNOWN"
        ],
        "description": "Measured provider health. A timeout is UNKNOWN, not UNREACHABLE."
      },
      "HealthReason": {
        "title": "HealthReason",
        "type": "string",
        "enum": [
          "OK",
          "NOT_CHECKED",
          "PROVIDER_DISABLED",
          "ENDPOINT_NOT_CONFIGURED",
          "CREDENTIAL_MISSING",
          "CREDENTIAL_STORE_UNAVAILABLE",
          "ENDPOINT_REJECTED",
          "CREDENTIAL_REJECTED",
          "CONNECTION_REFUSED",
          "NETWORK_UNREACHABLE",
          "NAME_RESOLUTION_FAILED",
          "TLS_FAILURE",
          "PROVIDER_TIMEOUT",
          "RATE_LIMITED",
          "SERVER_ERROR",
          "PROTOCOL_MISMATCH",
          "RESPONSE_INVALID",
          "EGRESS_DENIED"
        ],
        "description": "Machine reason for the health state."
      },
      "InstallationState": {
        "title": "InstallationState",
        "type": "string",
        "enum": [
          "DETECTED",
          "NOT_DETECTED",
          "NOT_APPLICABLE",
          "UNKNOWN"
        ],
        "description": "Presence in the known default locations only; NOT_DETECTED is not NOT_INSTALLED."
      },
      "RuntimeState": {
        "title": "RuntimeState",
        "type": "string",
        "enum": [
          "RUNNING",
          "NOT_RUNNING",
          "NOT_APPLICABLE",
          "UNKNOWN"
        ],
        "description": "Whether a local server answered on its endpoint at the last check."
      },
      "MeasuredMilliseconds": {
        "title": "MeasuredMilliseconds",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "value",
          "provenance"
        ],
        "properties": {
          "value": {
            "type": "integer",
            "minimum": 0,
            "maximum": 3600000
          },
          "provenance": {
            "const": "LOCALLY_MEASURED"
          }
        },
        "description": "A duration measured on this host."
      },
      "ProviderHealth": {
        "title": "ProviderHealth",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "state",
          "reason_code",
          "installation",
          "runtime"
        ],
        "properties": {
          "state": {
            "$ref": "#/$defs/HealthState"
          },
          "reason_code": {
            "$ref": "#/$defs/HealthReason"
          },
          "checked_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          },
          "latency": {
            "$ref": "#/$defs/MeasuredMilliseconds"
          },
          "installation": {
            "$ref": "#/$defs/InstallationState"
          },
          "runtime": {
            "$ref": "#/$defs/RuntimeState"
          }
        },
        "allOf": [
          {
            "$comment": "حالة مقيسة تتطلب لحظة القياس.",
            "if": {
              "type": "object",
              "properties": {
                "reason_code": {
                  "not": {
                    "enum": [
                      "NOT_CHECKED",
                      "PROVIDER_DISABLED",
                      "ENDPOINT_NOT_CONFIGURED",
                      "CREDENTIAL_MISSING",
                      "CREDENTIAL_STORE_UNAVAILABLE"
                    ]
                  }
                }
              },
              "required": [
                "reason_code"
              ]
            },
            "then": {
              "type": "object",
              "required": [
                "checked_at"
              ]
            }
          }
        ]
      },
      "CredentialSource": {
        "title": "CredentialSource",
        "type": "string",
        "enum": [
          "NONE",
          "CREDENTIAL_STORE",
          "ENVIRONMENT"
        ],
        "description": "Where the host found a credential. The value itself never crosses."
      },
      "CredentialState": {
        "title": "CredentialState",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "required",
          "configured",
          "source",
          "store_available"
        ],
        "properties": {
          "required": {
            "type": "boolean"
          },
          "configured": {
            "type": "boolean"
          },
          "source": {
            "$ref": "#/$defs/CredentialSource"
          },
          "reference": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "pattern": "^secret://providers/[a-z][a-z0-9-]{1,47}/default$"
          },
          "store_available": {
            "type": "boolean"
          },
          "environment_variable": {
            "type": "string",
            "minLength": 3,
            "maxLength": 64,
            "pattern": "^[A-Z][A-Z0-9_]{2,63}$"
          }
        },
        "description": "Credential facts only. There is no field that could carry a credential value.",
        "allOf": [
          {
            "if": {
              "type": "object",
              "properties": {
                "configured": {
                  "const": false
                }
              },
              "required": [
                "configured"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "source": {
                  "const": "NONE"
                }
              }
            },
            "else": {
              "type": "object",
              "properties": {
                "source": {
                  "enum": [
                    "CREDENTIAL_STORE",
                    "ENVIRONMENT"
                  ]
                }
              },
              "required": [
                "reference"
              ]
            }
          }
        ]
      },
      "ModelCounts": {
        "title": "ModelCounts",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "discovered",
          "enabled",
          "available"
        ],
        "properties": {
          "discovered": {
            "type": "integer",
            "minimum": 0,
            "maximum": 100000
          },
          "enabled": {
            "type": "integer",
            "minimum": 0,
            "maximum": 100000
          },
          "available": {
            "type": "integer",
            "minimum": 0,
            "maximum": 100000
          }
        }
      },
      "ProviderDescriptorView": {
        "title": "ProviderDescriptorView",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "provider_id",
          "kind",
          "display_name",
          "display_name_key",
          "endpoint_type",
          "auth_mode",
          "locality",
          "network_class",
          "endpoint_configurable",
          "enabled",
          "configured",
          "key_status",
          "capabilities",
          "health",
          "models"
        ],
        "properties": {
          "provider_id": {
            "$ref": "#/$defs/ProviderId"
          },
          "kind": {
            "$ref": "#/$defs/ProviderKind"
          },
          "display_name": {
            "type": "string",
            "minLength": 1,
            "maxLength": 64,
            "pattern": "^[^\\u0000-\\u001f\\u007f]*$"
          },
          "display_name_key": {
            "$ref": "./desktop-settings.schema.json#/$defs/DisplayKey"
          },
          "endpoint_type": {
            "$ref": "#/$defs/EndpointType"
          },
          "auth_mode": {
            "$ref": "#/$defs/AuthMode"
          },
          "locality": {
            "$ref": "#/$defs/Locality"
          },
          "network_class": {
            "$ref": "#/$defs/NetworkClass"
          },
          "endpoint": {
            "type": "string",
            "minLength": 8,
            "maxLength": 256,
            "pattern": "^https?://[A-Za-z0-9.\\[\\]:-]+(/[A-Za-z0-9._~/-]*)?$",
            "description": "Display form. Local endpoints are loopback only."
          },
          "endpoint_configurable": {
            "type": "boolean"
          },
          "enabled": {
            "type": "boolean"
          },
          "configured": {
            "type": "boolean"
          },
          "key_status": {
            "$ref": "#/$defs/CredentialState"
          },
          "capabilities": {
            "$ref": "#/$defs/ProviderCapabilities"
          },
          "health": {
            "$ref": "#/$defs/ProviderHealth"
          },
          "models": {
            "$ref": "#/$defs/ModelCounts"
          }
        },
        "description": "Facts about one provider. Nothing here is guessed, and nothing here is secret.",
        "allOf": [
          {
            "if": {
              "type": "object",
              "properties": {
                "locality": {
                  "const": "LOCAL"
                }
              },
              "required": [
                "locality"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "network_class": {
                  "const": "LOOPBACK_PROVIDER_ACCESS"
                },
                "auth_mode": {
                  "enum": [
                    "NO_AUTH_LOCAL",
                    "OPTIONAL_API_KEY"
                  ]
                }
              }
            },
            "else": {
              "type": "object",
              "properties": {
                "network_class": {
                  "const": "REMOTE_EGRESS"
                },
                "endpoint_configurable": {
                  "const": false
                }
              }
            }
          }
        ]
      },
      "ModelCapability": {
        "title": "ModelCapability",
        "type": "string",
        "enum": [
          "TEXT_INPUT",
          "TEXT_OUTPUT",
          "VISION_INPUT",
          "AUDIO_INPUT",
          "AUDIO_OUTPUT",
          "TOOLS",
          "JSON",
          "JSON_SCHEMA",
          "EMBEDDINGS",
          "REASONING",
          "STREAMING"
        ],
        "description": "Bounded capability vocabulary. There is no free-string capability."
      },
      "ModelCapabilityClaim": {
        "title": "ModelCapabilityClaim",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "capability",
          "support",
          "provenance"
        ],
        "properties": {
          "capability": {
            "$ref": "#/$defs/ModelCapability"
          },
          "support": {
            "$ref": "#/$defs/Support"
          },
          "provenance": {
            "$ref": "#/$defs/Provenance"
          }
        },
        "allOf": [
          {
            "$comment": "مدعوم أو غير مدعوم بلا مصدر ادعاءٌ بلا دليل، والمجهول لا مصدر له.",
            "if": {
              "type": "object",
              "properties": {
                "support": {
                  "const": "UNKNOWN"
                }
              },
              "required": [
                "support"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "provenance": {
                  "const": "UNKNOWN"
                }
              }
            },
            "else": {
              "type": "object",
              "properties": {
                "provenance": {
                  "not": {
                    "const": "UNKNOWN"
                  }
                }
              }
            }
          }
        ]
      },
      "ModelKind": {
        "title": "ModelKind",
        "type": "string",
        "enum": [
          "CHAT",
          "EMBEDDING",
          "UNKNOWN"
        ],
        "description": "What the provider reports the model is for."
      },
      "LoadedState": {
        "title": "LoadedState",
        "type": "string",
        "enum": [
          "LOADED",
          "NOT_LOADED",
          "UNKNOWN"
        ],
        "description": "Whether a local runtime reports the model as loaded. Polaris never loads or unloads a model itself."
      },
      "ModelAvailability": {
        "title": "ModelAvailability",
        "type": "string",
        "enum": [
          "AVAILABLE",
          "MISSING",
          "PROVIDER_UNREACHABLE",
          "UNKNOWN"
        ],
        "description": "AVAILABLE: present in the latest listing. MISSING: listed before, absent now; its configuration is kept. PROVIDER_UNREACHABLE: the last refresh could not list."
      },
      "Pricing": {
        "title": "Pricing",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "input_price_usd",
          "output_price_usd",
          "unit",
          "provenance"
        ],
        "properties": {
          "input_price_usd": {
            "type": "string",
            "minLength": 1,
            "maxLength": 24,
            "pattern": "^[0-9]+(\\.[0-9]+)?$"
          },
          "output_price_usd": {
            "type": "string",
            "minLength": 1,
            "maxLength": 24,
            "pattern": "^[0-9]+(\\.[0-9]+)?$"
          },
          "unit": {
            "const": "PER_TOKEN"
          },
          "provenance": {
            "const": "PROVIDER_REPORTED"
          }
        },
        "description": "Provider-reported price per token, as the decimal string the provider sent. Never computed or estimated here."
      },
      "LoadedFact": {
        "title": "LoadedFact",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "value",
          "provenance"
        ],
        "properties": {
          "value": {
            "$ref": "#/$defs/LoadedState"
          },
          "provenance": {
            "$ref": "#/$defs/Provenance"
          }
        }
      },
      "ModelView": {
        "title": "ModelView",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "model_id",
          "provider_id",
          "provider_model_id",
          "display_name",
          "kind",
          "family",
          "vendor",
          "architecture",
          "quantization",
          "parameter_count",
          "context_window",
          "max_output_tokens",
          "loaded_state",
          "capabilities",
          "locality",
          "enabled",
          "availability",
          "stale",
          "is_default",
          "provider_enabled",
          "provider_health",
          "first_seen_at",
          "last_seen_at"
        ],
        "properties": {
          "model_id": {
            "$ref": "#/$defs/ModelId"
          },
          "provider_id": {
            "$ref": "#/$defs/ProviderId"
          },
          "provider_model_id": {
            "$ref": "#/$defs/ProviderModelId"
          },
          "display_name": {
            "$ref": "#/$defs/FactText"
          },
          "kind": {
            "$ref": "#/$defs/ModelKind"
          },
          "family": {
            "$ref": "#/$defs/FactText"
          },
          "vendor": {
            "$ref": "#/$defs/FactText"
          },
          "architecture": {
            "$ref": "#/$defs/FactText"
          },
          "quantization": {
            "$ref": "#/$defs/FactText"
          },
          "parameter_count": {
            "$ref": "#/$defs/FactText"
          },
          "context_window": {
            "$ref": "#/$defs/FactInteger"
          },
          "max_output_tokens": {
            "$ref": "#/$defs/FactInteger"
          },
          "loaded_state": {
            "$ref": "#/$defs/LoadedFact"
          },
          "capabilities": {
            "type": "array",
            "minItems": 11,
            "maxItems": 11,
            "items": {
              "$ref": "#/$defs/ModelCapabilityClaim"
            }
          },
          "pricing": {
            "$ref": "#/$defs/Pricing"
          },
          "locality": {
            "$ref": "#/$defs/Locality"
          },
          "enabled": {
            "type": "boolean"
          },
          "availability": {
            "$ref": "#/$defs/ModelAvailability"
          },
          "stale": {
            "type": "boolean"
          },
          "is_default": {
            "type": "boolean"
          },
          "provider_enabled": {
            "type": "boolean"
          },
          "provider_health": {
            "$ref": "#/$defs/HealthState"
          },
          "first_seen_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          },
          "last_seen_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          }
        },
        "description": "A discovered model. DISCOVERED, ENABLED, AVAILABLE and LOADED are four separate facts."
      },
      "RoutingMode": {
        "title": "RoutingMode",
        "type": "string",
        "enum": [
          "MANUAL",
          "DEFAULT_MODEL",
          "CAPABILITY_MATCH"
        ],
        "description": "Phase-02 routing modes. There is no automatic quality, cost or ensemble routing."
      },
      "ModelPreferences": {
        "title": "ModelPreferences",
        "type": "object",
        "additionalProperties": false,
        "required": [],
        "properties": {
          "default_model_id": {
            "$ref": "#/$defs/ModelId"
          },
          "review_model_id": {
            "$ref": "#/$defs/ModelId"
          },
          "monitor_model_id": {
            "$ref": "#/$defs/ModelId",
            "description": "ADR-041: the model the user chose for the reasoning-blind action monitor. Absent: no monitor, and tier-3 actions keep their human approval."
          },
          "reasoning_effort": {
            "$ref": "#/$defs/ReasoningEffortLevel",
            "description": "The reasoning effort the user chose for every provider and model. Absent: each provider's default."
          }
        }
      },
      "Language": {
        "title": "Language",
        "type": "string",
        "enum": [
          "ar",
          "en",
          "de",
          "fr",
          "ru",
          "zh",
          "ko",
          "ja",
          "es"
        ],
        "description": "Project language, one of the nine architectural locales."
      },
      "ProjectStatus": {
        "title": "ProjectStatus",
        "type": "string",
        "enum": [
          "ACTIVE",
          "ARCHIVED"
        ],
        "description": "Normal removal is archival. Permanent deletion is not offered in Phase-02."
      },
      "ProjectName": {
        "type": "string",
        "minLength": 1,
        "maxLength": 120,
        "pattern": "^[^\\u0000-\\u001f\\u007f]*$",
        "description": "Display name."
      },
      "ProjectDescription": {
        "type": "string",
        "minLength": 0,
        "maxLength": 2000,
        "pattern": "^[^\\u0000-\\u001f\\u007f]*$",
        "description": "Free description. It is data, never an instruction."
      },
      "WorkspaceRoot": {
        "type": "string",
        "minLength": 3,
        "maxLength": 512,
        "pattern": "^(?:[A-Za-z]:\\\\|/)[^\\u0000-\\u001f\\u007f<>\"|?*]*$",
        "description": "An absolute local directory. A context scope reference, never a filesystem grant."
      },
      "ProjectView": {
        "title": "ProjectView",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "project_id",
          "name",
          "description",
          "status",
          "language",
          "version",
          "created_at",
          "updated_at",
          "context_source_count"
        ],
        "properties": {
          "project_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "name": {
            "$ref": "#/$defs/ProjectName"
          },
          "description": {
            "$ref": "#/$defs/ProjectDescription"
          },
          "status": {
            "$ref": "#/$defs/ProjectStatus"
          },
          "language": {
            "$ref": "#/$defs/Language"
          },
          "workspace_root": {
            "$ref": "#/$defs/WorkspaceRoot"
          },
          "default_model_id": {
            "$ref": "#/$defs/ModelId"
          },
          "version": {
            "type": "integer",
            "minimum": 1,
            "maximum": 1000000000
          },
          "created_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          },
          "updated_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          },
          "context_source_count": {
            "type": "integer",
            "minimum": 0,
            "maximum": 10000
          }
        }
      },
      "SourceType": {
        "title": "SourceType",
        "type": "string",
        "enum": [
          "WORKSPACE_ROOT",
          "FILE",
          "FOLDER",
          "TEXT_NOTE",
          "SYSTEM_CONTEXT",
          "USER_INSTRUCTION"
        ],
        "description": "Context source type."
      },
      "AddableSourceType": {
        "title": "AddableSourceType",
        "type": "string",
        "enum": [
          "FILE",
          "FOLDER",
          "TEXT_NOTE",
          "USER_INSTRUCTION"
        ],
        "description": "What the renderer may add. WORKSPACE_ROOT is created by the host from the project; SYSTEM_CONTEXT is host-generated and can never be supplied by the renderer."
      },
      "TrustClass": {
        "title": "TrustClass",
        "type": "string",
        "enum": [
          "DIRECT_USER_INSTRUCTION",
          "USER_AUTHORIZED_RESOURCE",
          "UNTRUSTED_CONTENT",
          "SYSTEM_GENERATED",
          "MODEL_GENERATED"
        ],
        "description": "USER_AUTHORIZED_RESOURCE is not a trusted instruction: permission to read a file does not make its content authoritative."
      },
      "ContentClass": {
        "title": "ContentClass",
        "type": "string",
        "enum": [
          "SOURCE_CODE",
          "DOCUMENTATION",
          "CONFIGURATION",
          "DATA",
          "IMAGE",
          "AUDIO",
          "BINARY",
          "UNKNOWN"
        ],
        "description": "Content classification. Only text classes are ever read as text."
      },
      "SourceAvailability": {
        "title": "SourceAvailability",
        "type": "string",
        "enum": [
          "AVAILABLE",
          "MISSING",
          "CHANGED",
          "OUT_OF_SCOPE",
          "NOT_READABLE",
          "UNKNOWN"
        ],
        "description": "Measured availability of a source at its last check."
      },
      "RelativeReference": {
        "type": "string",
        "minLength": 1,
        "maxLength": 512,
        "pattern": "^(?:\\.|[^.\\\\/\\u0000-\\u001f\\u007f<>\"|?*:][^\\\\/\\u0000-\\u001f\\u007f<>\"|?*:]*|\\.[^.\\\\/\\u0000-\\u001f\\u007f<>\"|?*:][^\\\\/\\u0000-\\u001f\\u007f<>\"|?*:]*|\\.\\.[^\\\\/\\u0000-\\u001f\\u007f<>\"|?*:]+)(?:[\\\\/](?:\\.|[^.\\\\/\\u0000-\\u001f\\u007f<>\"|?*:][^\\\\/\\u0000-\\u001f\\u007f<>\"|?*:]*|\\.[^.\\\\/\\u0000-\\u001f\\u007f<>\"|?*:][^\\\\/\\u0000-\\u001f\\u007f<>\"|?*:]*|\\.\\.[^\\\\/\\u0000-\\u001f\\u007f<>\"|?*:]+))*$",
        "description": "A path relative to the workspace root. Absolute paths, parent segments and stream names are unrepresentable."
      },
      "ContextSourceView": {
        "title": "ContextSourceView",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "source_id",
          "project_id",
          "source_type",
          "reference",
          "display_name",
          "trust_class",
          "content_class",
          "added_at",
          "availability"
        ],
        "properties": {
          "source_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "project_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "source_type": {
            "$ref": "#/$defs/SourceType"
          },
          "reference": {
            "type": "string",
            "minLength": 1,
            "maxLength": 512,
            "pattern": "^[^\\u0000-\\u001f\\u007f]*$"
          },
          "display_name": {
            "type": "string",
            "minLength": 1,
            "maxLength": 160,
            "pattern": "^[^\\u0000-\\u001f\\u007f]*$"
          },
          "trust_class": {
            "$ref": "#/$defs/TrustClass"
          },
          "content_class": {
            "$ref": "#/$defs/ContentClass"
          },
          "added_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          },
          "last_seen_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          },
          "availability": {
            "$ref": "#/$defs/SourceAvailability"
          },
          "digest": {
            "$ref": "./common/ids.schema.json#/$defs/Sha256Hex"
          },
          "byte_count": {
            "type": "integer",
            "minimum": 0,
            "maximum": 1099511627776
          }
        }
      },
      "TokenEstimate": {
        "title": "TokenEstimate",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "value",
          "provenance",
          "method"
        ],
        "properties": {
          "value": {
            "type": "integer",
            "minimum": 0,
            "maximum": 100000000
          },
          "provenance": {
            "enum": [
              "ESTIMATED",
              "PROVIDER_REPORTED"
            ]
          },
          "method": {
            "enum": [
              "UTF8_BYTES_DIV_4",
              "PROVIDER_TOKENIZER"
            ]
          }
        },
        "description": "A token count with its provenance. An estimate is labelled ESTIMATED."
      },
      "InclusionReason": {
        "title": "InclusionReason",
        "type": "string",
        "enum": [
          "USER_SELECTED",
          "FOLDER_MEMBER",
          "WORKSPACE_MEMBER"
        ],
        "description": "Why an item is in the bundle."
      },
      "OmissionReason": {
        "title": "OmissionReason",
        "type": "string",
        "enum": [
          "BUDGET_EXCEEDED",
          "MAX_FILES_EXCEEDED",
          "NOT_TEXT",
          "INVALID_ENCODING",
          "SENSITIVE_FILE_EXCLUDED",
          "OUT_OF_SCOPE",
          "MISSING",
          "NOT_READABLE",
          "REPARSE_POINT",
          "SOURCE_REMOVED",
          "UNKNOWN_SOURCE",
          "TOO_LARGE_TO_READ"
        ],
        "description": "Why a candidate was left out. Nothing is left out silently."
      },
      "ContextItem": {
        "title": "ContextItem",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "source_id",
          "item_reference",
          "trust_class",
          "content_class",
          "inclusion_reason",
          "digest",
          "byte_count",
          "included_bytes",
          "estimated_tokens",
          "truncated"
        ],
        "properties": {
          "source_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "item_reference": {
            "type": "string",
            "minLength": 1,
            "maxLength": 512,
            "pattern": "^[^\\u0000-\\u001f\\u007f]*$"
          },
          "trust_class": {
            "$ref": "#/$defs/TrustClass"
          },
          "content_class": {
            "$ref": "#/$defs/ContentClass"
          },
          "inclusion_reason": {
            "$ref": "#/$defs/InclusionReason"
          },
          "digest": {
            "$ref": "./common/ids.schema.json#/$defs/Sha256Hex"
          },
          "byte_count": {
            "type": "integer",
            "minimum": 0,
            "maximum": 1099511627776
          },
          "included_bytes": {
            "type": "integer",
            "minimum": 0,
            "maximum": 1073741824
          },
          "estimated_tokens": {
            "$ref": "#/$defs/TokenEstimate"
          },
          "truncated": {
            "type": "boolean"
          }
        }
      },
      "OmittedItem": {
        "title": "OmittedItem",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "source_id",
          "item_reference",
          "reason"
        ],
        "properties": {
          "source_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "item_reference": {
            "type": "string",
            "minLength": 1,
            "maxLength": 512,
            "pattern": "^[^\\u0000-\\u001f\\u007f]*$"
          },
          "reason": {
            "$ref": "#/$defs/OmissionReason"
          }
        }
      },
      "ContextBudget": {
        "title": "ContextBudget",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "max_sources",
          "max_files",
          "max_total_bytes",
          "max_single_source_bytes",
          "max_tokens",
          "context_window_known",
          "reserved_output_tokens"
        ],
        "properties": {
          "max_sources": {
            "type": "integer",
            "minimum": 1,
            "maximum": 64
          },
          "max_files": {
            "type": "integer",
            "minimum": 1,
            "maximum": 256
          },
          "max_total_bytes": {
            "type": "integer",
            "minimum": 1,
            "maximum": 4194304
          },
          "max_single_source_bytes": {
            "type": "integer",
            "minimum": 1,
            "maximum": 1048576
          },
          "max_tokens": {
            "type": "integer",
            "minimum": 1,
            "maximum": 2000000
          },
          "context_window_known": {
            "type": "boolean"
          },
          "reserved_output_tokens": {
            "type": "integer",
            "minimum": 0,
            "maximum": 200000
          }
        },
        "description": "The hard budget actually applied."
      },
      "ContextBundleView": {
        "title": "ContextBundleView",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "project_id",
          "bundle_digest",
          "items",
          "omitted",
          "instruction_trust_class",
          "total_bytes",
          "estimated_tokens",
          "budget",
          "truncated"
        ],
        "properties": {
          "project_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "bundle_digest": {
            "$ref": "./common/ids.schema.json#/$defs/Sha256Hex"
          },
          "items": {
            "type": "array",
            "minItems": 0,
            "maxItems": 256,
            "items": {
              "$ref": "#/$defs/ContextItem"
            }
          },
          "omitted": {
            "type": "array",
            "minItems": 0,
            "maxItems": 512,
            "items": {
              "$ref": "#/$defs/OmittedItem"
            }
          },
          "instruction_trust_class": {
            "const": "DIRECT_USER_INSTRUCTION"
          },
          "total_bytes": {
            "type": "integer",
            "minimum": 0,
            "maximum": 4194304
          },
          "estimated_tokens": {
            "$ref": "#/$defs/TokenEstimate"
          },
          "budget": {
            "$ref": "#/$defs/ContextBudget"
          },
          "truncated": {
            "type": "boolean"
          }
        },
        "description": "Metadata of a deterministic context bundle. Content stays in the host."
      },
      "ProviderOutcomeCode": {
        "title": "ProviderOutcomeCode",
        "type": "string",
        "enum": [
          "PROVIDER_UNREACHABLE",
          "PROVIDER_TIMEOUT",
          "AUTH_REQUIRED",
          "AUTH_FAILED",
          "MODEL_NOT_FOUND",
          "MODEL_UNAVAILABLE",
          "RATE_LIMITED",
          "INVALID_REQUEST",
          "UNSUPPORTED_CAPABILITY",
          "PROVIDER_RESPONSE_INVALID",
          "PROVIDER_INTERNAL_ERROR",
          "CANCELLED",
          "EGRESS_DENIED",
          "CREDENTIAL_STORE_UNAVAILABLE",
          "ENDPOINT_NOT_CONFIGURED",
          "PROVIDER_DISABLED"
        ],
        "description": "Normalised provider outcome. Raw provider bodies never cross."
      },
      "ProviderOutcome": {
        "title": "ProviderOutcome",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "code",
          "retryable"
        ],
        "properties": {
          "code": {
            "$ref": "#/$defs/ProviderOutcomeCode"
          },
          "retryable": {
            "type": "boolean"
          }
        }
      },
      "ReasoningEffortLevel": {
        "title": "ReasoningEffortLevel",
        "type": "string",
        "enum": [
          "LOW",
          "MEDIUM",
          "HIGH",
          "MAX"
        ],
        "description": "How much hidden reasoning the user asks every provider for. MAX is the provider's highest level; a compatible interface that stops at high receives high."
      }
    }
  } as unknown as SchemaDocument,
  "desktop-p02-request.v1.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "DesktopPhase02RequestPayloadV1",
    "description": "The closed set of request payloads the nineteen Phase-02 operations accept. Every payload is a closed object; no field can carry a URL chosen by the renderer, a header, or a credential.",
    "$comment": "كل حمولة مغلقة. لا عنوان حرّ، ولا ترويسة، ولا سرّ، ولا اسم عملية داخل الحمولة.",
    "anyOf": [
      {
        "$ref": "#/$defs/ProviderListRequestV1"
      },
      {
        "$ref": "#/$defs/ProviderConfigureRequestV1"
      },
      {
        "$ref": "#/$defs/ProviderCredentialSetRequestV1"
      },
      {
        "$ref": "#/$defs/ProviderCredentialClearRequestV1"
      },
      {
        "$ref": "#/$defs/ProviderRefreshRequestV1"
      },
      {
        "$ref": "#/$defs/ModelListRequestV1"
      },
      {
        "$ref": "#/$defs/ModelConfigureRequestV1"
      },
      {
        "$ref": "#/$defs/ModelPreferencesSetRequestV1"
      },
      {
        "$ref": "#/$defs/ModelInvokeRequestV1"
      },
      {
        "$ref": "#/$defs/ModelCancelRequestV1"
      },
      {
        "$ref": "#/$defs/ProjectListRequestV1"
      },
      {
        "$ref": "#/$defs/ProjectGetRequestV1"
      },
      {
        "$ref": "#/$defs/ProjectCreateRequestV1"
      },
      {
        "$ref": "#/$defs/ProjectUpdateRequestV1"
      },
      {
        "$ref": "#/$defs/ProjectArchiveRequestV1"
      },
      {
        "$ref": "#/$defs/ContextAddRequestV1"
      },
      {
        "$ref": "#/$defs/ContextRemoveRequestV1"
      },
      {
        "$ref": "#/$defs/ContextPreviewRequestV1"
      },
      {
        "$ref": "#/$defs/ContextAssembleRequestV1"
      }
    ],
    "$defs": {
      "ProviderListRequestV1": {
        "title": "ProviderListRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [],
        "properties": {},
        "description": "Lists every registered provider with its last known health. No network access."
      },
      "ProviderConfigureRequestV1": {
        "title": "ProviderConfigureRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "provider_id"
        ],
        "properties": {
          "provider_id": {
            "$ref": "./desktop-p02-domain.schema.json#/$defs/ProviderId"
          },
          "enabled": {
            "type": "boolean"
          },
          "endpoint": {
            "type": "string",
            "minLength": 8,
            "maxLength": 256,
            "pattern": "^http://(?:127\\.0\\.0\\.1|localhost|\\[::1\\]):[0-9]{1,5}(/[A-Za-z0-9._~/-]*)?$",
            "description": "A loopback endpoint for a local provider. Remote endpoints are fixed by the host and cannot be supplied."
          }
        },
        "minProperties": 2
      },
      "ProviderCredentialSetRequestV1": {
        "title": "ProviderCredentialSetRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "provider_id"
        ],
        "properties": {
          "provider_id": {
            "$ref": "./desktop-p02-domain.schema.json#/$defs/ProviderId"
          }
        },
        "description": "Asks the host to open its native credential prompt. The request carries no credential and no field could carry one."
      },
      "ProviderCredentialClearRequestV1": {
        "title": "ProviderCredentialClearRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "provider_id"
        ],
        "properties": {
          "provider_id": {
            "$ref": "./desktop-p02-domain.schema.json#/$defs/ProviderId"
          }
        }
      },
      "ProviderRefreshRequestV1": {
        "title": "ProviderRefreshRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "provider_ids"
        ],
        "properties": {
          "provider_ids": {
            "type": "array",
            "minItems": 1,
            "maxItems": 16,
            "uniqueItems": true,
            "items": {
              "$ref": "./desktop-p02-domain.schema.json#/$defs/ProviderId"
            }
          }
        },
        "description": "Probes health and discovers models for the named, enabled providers. A bounded list; there is no refresh-everything wildcard."
      },
      "ModelListRequestV1": {
        "title": "ModelListRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [],
        "properties": {
          "provider_id": {
            "$ref": "./desktop-p02-domain.schema.json#/$defs/ProviderId"
          },
          "only_selectable": {
            "type": "boolean"
          }
        }
      },
      "ModelConfigureRequestV1": {
        "title": "ModelConfigureRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "model_id",
          "enabled"
        ],
        "properties": {
          "model_id": {
            "$ref": "./desktop-p02-domain.schema.json#/$defs/ModelId"
          },
          "enabled": {
            "type": "boolean"
          }
        }
      },
      "ModelPreferencesSetRequestV1": {
        "title": "ModelPreferencesSetRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [],
        "properties": {
          "default_model_id": {
            "oneOf": [
              {
                "$ref": "./desktop-p02-domain.schema.json#/$defs/ModelId"
              },
              {
                "type": "null"
              }
            ]
          },
          "monitor_model_id": {
            "oneOf": [
              {
                "$ref": "./desktop-p02-domain.schema.json#/$defs/ModelId"
              },
              {
                "type": "null"
              }
            ],
            "description": "ADR-041: the reasoning-blind action monitor's model. null clears it."
          },
          "review_model_id": {
            "oneOf": [
              {
                "$ref": "./desktop-p02-domain.schema.json#/$defs/ModelId"
              },
              {
                "type": "null"
              }
            ],
            "description": "The reviewer model (ADR-040): any discovered model the user chooses, local or remote. Absent or null means no independent review. The host never calls a reviewer the user did not choose."
          },
          "reasoning_effort": {
            "oneOf": [
              {
                "$ref": "./desktop-p02-domain.schema.json#/$defs/ReasoningEffortLevel"
              },
              {
                "type": "null"
              }
            ],
            "description": "The reasoning effort for every provider and model. null returns each provider to its default."
          }
        },
        "minProperties": 1
      },
      "InvocationMessage": {
        "title": "InvocationMessage",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "role",
          "text"
        ],
        "properties": {
          "role": {
            "enum": [
              "USER",
              "ASSISTANT"
            ]
          },
          "text": {
            "type": "string",
            "minLength": 1,
            "maxLength": 32000
          }
        },
        "description": "A conversation turn. The renderer cannot author SYSTEM or TOOL turns."
      },
      "ModelInvokeRequestV1": {
        "title": "ModelInvokeRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "invocation_id",
          "routing_mode",
          "messages"
        ],
        "properties": {
          "invocation_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "routing_mode": {
            "$ref": "./desktop-p02-domain.schema.json#/$defs/RoutingMode"
          },
          "model_id": {
            "$ref": "./desktop-p02-domain.schema.json#/$defs/ModelId"
          },
          "required_capabilities": {
            "type": "array",
            "minItems": 0,
            "maxItems": 11,
            "uniqueItems": true,
            "items": {
              "$ref": "./desktop-p02-domain.schema.json#/$defs/ModelCapability"
            }
          },
          "project_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "context_source_ids": {
            "type": "array",
            "minItems": 0,
            "maxItems": 32,
            "uniqueItems": true,
            "items": {
              "$ref": "./common/ids.schema.json#/$defs/Uuid"
            }
          },
          "messages": {
            "type": "array",
            "minItems": 1,
            "maxItems": 32,
            "items": {
              "$ref": "#/$defs/InvocationMessage"
            }
          },
          "system_instruction": {
            "type": "string",
            "minLength": 1,
            "maxLength": 8000
          },
          "temperature": {
            "type": "number",
            "minimum": 0,
            "maximum": 2
          },
          "max_output_tokens": {
            "type": "integer",
            "minimum": 1,
            "maximum": 32768
          },
          "response_format": {
            "enum": [
              "TEXT",
              "JSON"
            ]
          },
          "timeout_ms": {
            "type": "integer",
            "minimum": 1000,
            "maximum": 300000
          }
        },
        "description": "A model invocation. There is no URL, header, credential or provider-specific field.",
        "allOf": [
          {
            "$comment": "الاختيار اليدوي يسمّي نموذجًا، وبقية الأنماط لا تسمّي.",
            "if": {
              "type": "object",
              "properties": {
                "routing_mode": {
                  "const": "MANUAL"
                }
              },
              "required": [
                "routing_mode"
              ]
            },
            "then": {
              "type": "object",
              "required": [
                "model_id"
              ]
            },
            "else": {
              "type": "object",
              "not": {
                "type": "object",
                "required": [
                  "model_id"
                ]
              }
            }
          },
          {
            "if": {
              "type": "object",
              "required": [
                "context_source_ids"
              ]
            },
            "then": {
              "type": "object",
              "required": [
                "project_id"
              ]
            }
          }
        ]
      },
      "ModelCancelRequestV1": {
        "title": "ModelCancelRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "invocation_id"
        ],
        "properties": {
          "invocation_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          }
        },
        "description": "Cancels one invocation of this session. There is no cancel-all."
      },
      "ProjectListRequestV1": {
        "title": "ProjectListRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [],
        "properties": {
          "include_archived": {
            "type": "boolean"
          },
          "query": {
            "type": "string",
            "minLength": 1,
            "maxLength": 120,
            "pattern": "^[^\\u0000-\\u001f\\u007f]*$"
          }
        }
      },
      "ProjectGetRequestV1": {
        "title": "ProjectGetRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "project_id"
        ],
        "properties": {
          "project_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          }
        }
      },
      "ProjectCreateRequestV1": {
        "title": "ProjectCreateRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "name"
        ],
        "properties": {
          "name": {
            "$ref": "./desktop-p02-domain.schema.json#/$defs/ProjectName"
          },
          "description": {
            "$ref": "./desktop-p02-domain.schema.json#/$defs/ProjectDescription"
          },
          "language": {
            "$ref": "./desktop-p02-domain.schema.json#/$defs/Language"
          },
          "workspace_root": {
            "$ref": "./desktop-p02-domain.schema.json#/$defs/WorkspaceRoot"
          }
        }
      },
      "ProjectUpdateRequestV1": {
        "title": "ProjectUpdateRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "project_id",
          "expected_version"
        ],
        "properties": {
          "project_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "expected_version": {
            "type": "integer",
            "minimum": 1,
            "maximum": 1000000000
          },
          "name": {
            "$ref": "./desktop-p02-domain.schema.json#/$defs/ProjectName"
          },
          "description": {
            "$ref": "./desktop-p02-domain.schema.json#/$defs/ProjectDescription"
          },
          "language": {
            "$ref": "./desktop-p02-domain.schema.json#/$defs/Language"
          },
          "workspace_root": {
            "oneOf": [
              {
                "$ref": "./desktop-p02-domain.schema.json#/$defs/WorkspaceRoot"
              },
              {
                "type": "null"
              }
            ]
          },
          "default_model_id": {
            "oneOf": [
              {
                "$ref": "./desktop-p02-domain.schema.json#/$defs/ModelId"
              },
              {
                "type": "null"
              }
            ]
          }
        },
        "description": "Optimistic update: a stale expected_version is a conflict, not a silent overwrite.",
        "minProperties": 3
      },
      "ProjectArchiveRequestV1": {
        "title": "ProjectArchiveRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "project_id",
          "expected_version",
          "archived"
        ],
        "properties": {
          "project_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "expected_version": {
            "type": "integer",
            "minimum": 1,
            "maximum": 1000000000
          },
          "archived": {
            "type": "boolean"
          }
        }
      },
      "ContextAddRequestV1": {
        "title": "ContextAddRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "project_id",
          "source_type"
        ],
        "properties": {
          "project_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "source_type": {
            "$ref": "./desktop-p02-domain.schema.json#/$defs/AddableSourceType"
          },
          "reference": {
            "$ref": "./desktop-p02-domain.schema.json#/$defs/RelativeReference"
          },
          "text": {
            "type": "string",
            "minLength": 1,
            "maxLength": 16000
          },
          "display_name": {
            "type": "string",
            "minLength": 1,
            "maxLength": 160,
            "pattern": "^[^\\u0000-\\u001f\\u007f]*$"
          }
        },
        "allOf": [
          {
            "if": {
              "type": "object",
              "properties": {
                "source_type": {
                  "enum": [
                    "FILE",
                    "FOLDER"
                  ]
                }
              },
              "required": [
                "source_type"
              ]
            },
            "then": {
              "type": "object",
              "required": [
                "reference"
              ],
              "not": {
                "type": "object",
                "required": [
                  "text"
                ]
              }
            }
          },
          {
            "if": {
              "type": "object",
              "properties": {
                "source_type": {
                  "enum": [
                    "TEXT_NOTE",
                    "USER_INSTRUCTION"
                  ]
                }
              },
              "required": [
                "source_type"
              ]
            },
            "then": {
              "type": "object",
              "required": [
                "text",
                "display_name"
              ],
              "not": {
                "type": "object",
                "required": [
                  "reference"
                ]
              }
            }
          }
        ]
      },
      "ContextRemoveRequestV1": {
        "title": "ContextRemoveRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "project_id",
          "source_id"
        ],
        "properties": {
          "project_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "source_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          }
        }
      },
      "ContextPreviewRequestV1": {
        "title": "ContextPreviewRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "project_id",
          "source_id"
        ],
        "properties": {
          "project_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "source_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          }
        }
      },
      "ContextAssembleRequestV1": {
        "title": "ContextAssembleRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "project_id",
          "source_ids",
          "instruction"
        ],
        "properties": {
          "project_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "source_ids": {
            "type": "array",
            "minItems": 1,
            "maxItems": 32,
            "uniqueItems": true,
            "items": {
              "$ref": "./common/ids.schema.json#/$defs/Uuid"
            }
          },
          "instruction": {
            "type": "string",
            "minLength": 1,
            "maxLength": 8000
          },
          "model_id": {
            "$ref": "./desktop-p02-domain.schema.json#/$defs/ModelId"
          },
          "max_tokens": {
            "type": "integer",
            "minimum": 256,
            "maximum": 200000
          },
          "max_files": {
            "type": "integer",
            "minimum": 1,
            "maximum": 64
          }
        }
      }
    }
  } as unknown as SchemaDocument,
  "desktop-p02-result.v1.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "DesktopPhase02ResultPayloadV1",
    "description": "The closed set of result payloads of the Phase-02 operations. No field carries a credential, a raw provider body, a stack or an internal host path beyond the user's own workspace references.",
    "$comment": "النتائج مغلقة. ناتج النموذج بيانات ملوّثة بلا سلطة، ونتيجة المزوّد رمز مطبّع لا جسم خام.",
    "anyOf": [
      {
        "$ref": "#/$defs/ProviderListResultV1"
      },
      {
        "$ref": "#/$defs/ProviderConfigureResultV1"
      },
      {
        "$ref": "#/$defs/ProviderCredentialResultV1"
      },
      {
        "$ref": "#/$defs/ProviderRefreshResultV1"
      },
      {
        "$ref": "#/$defs/ModelListResultV1"
      },
      {
        "$ref": "#/$defs/ModelConfigureResultV1"
      },
      {
        "$ref": "#/$defs/ModelPreferencesSetResultV1"
      },
      {
        "$ref": "#/$defs/ModelInvokeResultV1"
      },
      {
        "$ref": "#/$defs/ModelCancelResultV1"
      },
      {
        "$ref": "#/$defs/ProjectListResultV1"
      },
      {
        "$ref": "#/$defs/ProjectGetResultV1"
      },
      {
        "$ref": "#/$defs/ProjectMutationResultV1"
      },
      {
        "$ref": "#/$defs/ContextSourceResultV1"
      },
      {
        "$ref": "#/$defs/ContextPreviewResultV1"
      },
      {
        "$ref": "#/$defs/ContextAssembleResultV1"
      }
    ],
    "$defs": {
      "ProviderListResultV1": {
        "title": "ProviderListResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "providers"
        ],
        "properties": {
          "providers": {
            "type": "array",
            "minItems": 0,
            "maxItems": 128,
            "items": {
              "$ref": "./desktop-p02-domain.schema.json#/$defs/ProviderDescriptorView"
            }
          }
        }
      },
      "ProviderConfigureResultV1": {
        "title": "ProviderConfigureResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "provider"
        ],
        "properties": {
          "provider": {
            "$ref": "./desktop-p02-domain.schema.json#/$defs/ProviderDescriptorView"
          }
        }
      },
      "ProviderCredentialResultV1": {
        "title": "ProviderCredentialResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "provider_id",
          "outcome",
          "key_status"
        ],
        "properties": {
          "provider_id": {
            "$ref": "./desktop-p02-domain.schema.json#/$defs/ProviderId"
          },
          "outcome": {
            "enum": [
              "STORED",
              "CLEARED",
              "PROMPT_CANCELLED",
              "STORE_UNAVAILABLE",
              "NOT_APPLICABLE",
              "NOTHING_TO_CLEAR"
            ]
          },
          "key_status": {
            "$ref": "./desktop-p02-domain.schema.json#/$defs/CredentialState"
          }
        },
        "description": "The credential outcome. The value never crosses."
      },
      "ProviderRefreshEntry": {
        "title": "ProviderRefreshEntry",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "provider_id",
          "health",
          "models",
          "duration"
        ],
        "properties": {
          "provider_id": {
            "$ref": "./desktop-p02-domain.schema.json#/$defs/ProviderId"
          },
          "health": {
            "$ref": "./desktop-p02-domain.schema.json#/$defs/ProviderHealth"
          },
          "models": {
            "$ref": "./desktop-p02-domain.schema.json#/$defs/ModelCounts"
          },
          "outcome": {
            "$ref": "./desktop-p02-domain.schema.json#/$defs/ProviderOutcome"
          },
          "duration": {
            "$ref": "./desktop-p02-domain.schema.json#/$defs/MeasuredMilliseconds"
          }
        }
      },
      "ProviderRefreshResultV1": {
        "title": "ProviderRefreshResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "results"
        ],
        "properties": {
          "results": {
            "type": "array",
            "minItems": 1,
            "maxItems": 16,
            "items": {
              "$ref": "#/$defs/ProviderRefreshEntry"
            }
          }
        }
      },
      "ModelListResultV1": {
        "title": "ModelListResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "models",
          "preferences"
        ],
        "properties": {
          "models": {
            "type": "array",
            "minItems": 0,
            "maxItems": 4000,
            "items": {
              "$ref": "./desktop-p02-domain.schema.json#/$defs/ModelView"
            }
          },
          "preferences": {
            "$ref": "./desktop-p02-domain.schema.json#/$defs/ModelPreferences"
          }
        }
      },
      "ModelConfigureResultV1": {
        "title": "ModelConfigureResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "model"
        ],
        "properties": {
          "model": {
            "$ref": "./desktop-p02-domain.schema.json#/$defs/ModelView"
          }
        }
      },
      "ModelPreferencesSetResultV1": {
        "title": "ModelPreferencesSetResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "preferences"
        ],
        "properties": {
          "preferences": {
            "$ref": "./desktop-p02-domain.schema.json#/$defs/ModelPreferences"
          }
        }
      },
      "RoutingDecisionView": {
        "title": "RoutingDecisionView",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "mode",
          "decision",
          "reason_codes",
          "candidates_considered"
        ],
        "properties": {
          "mode": {
            "$ref": "./desktop-p02-domain.schema.json#/$defs/RoutingMode"
          },
          "decision": {
            "enum": [
              "SELECTED",
              "DENIED"
            ]
          },
          "model_id": {
            "$ref": "./desktop-p02-domain.schema.json#/$defs/ModelId"
          },
          "provider_id": {
            "$ref": "./desktop-p02-domain.schema.json#/$defs/ProviderId"
          },
          "locality": {
            "$ref": "./desktop-p02-domain.schema.json#/$defs/Locality"
          },
          "reason_codes": {
            "type": "array",
            "minItems": 1,
            "maxItems": 8,
            "uniqueItems": true,
            "items": {
              "enum": [
                "MANUAL_SELECTION",
                "PROJECT_DEFAULT",
                "USER_DEFAULT",
                "SOLE_ENABLED_MODEL",
                "CAPABILITY_MATCH",
                "NO_MODEL_CONFIGURED",
                "MODEL_NOT_FOUND",
                "MODEL_DISABLED",
                "MODEL_UNAVAILABLE",
                "MODEL_NOT_CHAT",
                "PROVIDER_DISABLED",
                "PROVIDER_UNHEALTHY",
                "CAPABILITY_MISSING",
                "CAPABILITY_UNKNOWN",
                "NO_CANDIDATE",
                "CONTEXT_TOO_LARGE",
                "PROJECT_NOT_FOUND",
                "PROJECT_ARCHIVED",
                "SOURCE_NOT_IN_PROJECT",
                "CANCELLED_BEFORE_START"
              ]
            }
          },
          "candidates_considered": {
            "type": "integer",
            "minimum": 0,
            "maximum": 4000
          }
        },
        "allOf": [
          {
            "if": {
              "type": "object",
              "properties": {
                "decision": {
                  "const": "SELECTED"
                }
              },
              "required": [
                "decision"
              ]
            },
            "then": {
              "type": "object",
              "required": [
                "model_id",
                "provider_id",
                "locality"
              ]
            }
          }
        ]
      },
      "EgressDecisionView": {
        "title": "EgressDecisionView",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "decision",
          "reason",
          "context_attached"
        ],
        "properties": {
          "network_class": {
            "$ref": "./desktop-p02-domain.schema.json#/$defs/NetworkClass"
          },
          "decision": {
            "enum": [
              "ALLOWED",
              "DENIED",
              "NOT_EVALUATED"
            ]
          },
          "reason": {
            "enum": [
              "LOOPBACK",
              "REMOTE_ALLOWED",
              "ROUTING_DENIED"
            ]
          },
          "context_attached": {
            "type": "boolean"
          }
        }
      },
      "UsageView": {
        "title": "UsageView",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "input_tokens",
          "output_tokens"
        ],
        "properties": {
          "input_tokens": {
            "$ref": "./desktop-p02-domain.schema.json#/$defs/FactInteger"
          },
          "output_tokens": {
            "$ref": "./desktop-p02-domain.schema.json#/$defs/FactInteger"
          }
        }
      },
      "InvocationTiming": {
        "title": "InvocationTiming",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "total",
          "streamed"
        ],
        "properties": {
          "total": {
            "$ref": "./desktop-p02-domain.schema.json#/$defs/MeasuredMilliseconds"
          },
          "first_byte": {
            "$ref": "./desktop-p02-domain.schema.json#/$defs/MeasuredMilliseconds"
          },
          "streamed": {
            "type": "boolean"
          }
        }
      },
      "InvocationOutputView": {
        "title": "InvocationOutputView",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "text",
          "trust_class",
          "authority"
        ],
        "properties": {
          "text": {
            "type": "string",
            "maxLength": 256000
          },
          "trust_class": {
            "const": "MODEL_GENERATED"
          },
          "authority": {
            "const": "NONE"
          }
        },
        "description": "Model output is tainted data with no authority."
      },
      "InvocationContextSummary": {
        "title": "InvocationContextSummary",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "items",
          "omitted",
          "estimated_tokens",
          "truncated",
          "bundle_digest"
        ],
        "properties": {
          "items": {
            "type": "integer",
            "minimum": 0,
            "maximum": 256
          },
          "omitted": {
            "type": "integer",
            "minimum": 0,
            "maximum": 512
          },
          "estimated_tokens": {
            "$ref": "./desktop-p02-domain.schema.json#/$defs/TokenEstimate"
          },
          "truncated": {
            "type": "boolean"
          },
          "bundle_digest": {
            "$ref": "./common/ids.schema.json#/$defs/Sha256Hex"
          }
        }
      },
      "ModelInvokeResultV1": {
        "title": "ModelInvokeResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "invocation_id",
          "status",
          "routing",
          "egress",
          "timing"
        ],
        "properties": {
          "invocation_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "status": {
            "enum": [
              "COMPLETED",
              "FAILED",
              "CANCELLED",
              "DENIED",
              "TIMED_OUT"
            ]
          },
          "routing": {
            "$ref": "#/$defs/RoutingDecisionView"
          },
          "egress": {
            "$ref": "#/$defs/EgressDecisionView"
          },
          "output": {
            "$ref": "#/$defs/InvocationOutputView"
          },
          "finish_reason": {
            "enum": [
              "STOP",
              "LENGTH",
              "CONTENT_FILTER",
              "TOOL_CALL",
              "CANCELLED",
              "UNKNOWN"
            ]
          },
          "usage": {
            "$ref": "#/$defs/UsageView"
          },
          "timing": {
            "$ref": "#/$defs/InvocationTiming"
          },
          "context": {
            "$ref": "#/$defs/InvocationContextSummary"
          },
          "error": {
            "$ref": "./desktop-p02-domain.schema.json#/$defs/ProviderOutcome"
          },
          "provider_request_id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "pattern": "^[A-Za-z0-9._:-]+$"
          }
        },
        "allOf": [
          {
            "if": {
              "type": "object",
              "properties": {
                "status": {
                  "const": "COMPLETED"
                }
              },
              "required": [
                "status"
              ]
            },
            "then": {
              "type": "object",
              "required": [
                "output",
                "finish_reason",
                "usage"
              ],
              "not": {
                "type": "object",
                "required": [
                  "error"
                ]
              }
            },
            "else": {
              "type": "object",
              "not": {
                "type": "object",
                "required": [
                  "output"
                ]
              }
            }
          },
          {
            "if": {
              "type": "object",
              "properties": {
                "status": {
                  "enum": [
                    "FAILED",
                    "TIMED_OUT"
                  ]
                }
              },
              "required": [
                "status"
              ]
            },
            "then": {
              "type": "object",
              "required": [
                "error"
              ]
            }
          }
        ]
      },
      "ModelCancelResultV1": {
        "title": "ModelCancelResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "invocation_id",
          "outcome"
        ],
        "properties": {
          "invocation_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "outcome": {
            "enum": [
              "CANCELLATION_REQUESTED",
              "ALREADY_FINISHED",
              "PRE_CANCELLED"
            ]
          }
        }
      },
      "ProjectListResultV1": {
        "title": "ProjectListResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "projects"
        ],
        "properties": {
          "projects": {
            "type": "array",
            "minItems": 0,
            "maxItems": 1000,
            "items": {
              "$ref": "./desktop-p02-domain.schema.json#/$defs/ProjectView"
            }
          }
        }
      },
      "ProjectGetResultV1": {
        "title": "ProjectGetResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "project",
          "sources",
          "effective_model_origin"
        ],
        "properties": {
          "project": {
            "$ref": "./desktop-p02-domain.schema.json#/$defs/ProjectView"
          },
          "sources": {
            "type": "array",
            "minItems": 0,
            "maxItems": 512,
            "items": {
              "$ref": "./desktop-p02-domain.schema.json#/$defs/ContextSourceView"
            }
          },
          "effective_model_id": {
            "$ref": "./desktop-p02-domain.schema.json#/$defs/ModelId"
          },
          "effective_model_origin": {
            "enum": [
              "PROJECT_DEFAULT",
              "USER_DEFAULT",
              "NONE"
            ]
          }
        }
      },
      "ProjectMutationResultV1": {
        "title": "ProjectMutationResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "project"
        ],
        "properties": {
          "project": {
            "$ref": "./desktop-p02-domain.schema.json#/$defs/ProjectView"
          }
        }
      },
      "ContextSourceResultV1": {
        "title": "ContextSourceResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "source"
        ],
        "properties": {
          "source": {
            "$ref": "./desktop-p02-domain.schema.json#/$defs/ContextSourceView"
          }
        }
      },
      "ContextPreviewResultV1": {
        "title": "ContextPreviewResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "source",
          "encoding",
          "preview_trust_class"
        ],
        "properties": {
          "source": {
            "$ref": "./desktop-p02-domain.schema.json#/$defs/ContextSourceView"
          },
          "preview": {
            "type": "string",
            "maxLength": 4096
          },
          "preview_truncated": {
            "type": "boolean"
          },
          "encoding": {
            "enum": [
              "UTF8",
              "NOT_TEXT",
              "INVALID",
              "NONE"
            ]
          },
          "entries": {
            "type": "array",
            "minItems": 0,
            "maxItems": 200,
            "items": {
              "type": "string",
              "minLength": 1,
              "maxLength": 512,
              "pattern": "^[^\\u0000-\\u001f\\u007f]*$"
            }
          },
          "modified_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          },
          "preview_trust_class": {
            "const": "UNTRUSTED_CONTENT"
          }
        },
        "description": "Bounded metadata and a bounded text preview. The preview is untrusted content."
      },
      "ContextAssembleResultV1": {
        "title": "ContextAssembleResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "bundle"
        ],
        "properties": {
          "bundle": {
            "$ref": "./desktop-p02-domain.schema.json#/$defs/ContextBundleView"
          }
        }
      }
    }
  } as unknown as SchemaDocument,
  "desktop-p03-domain.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "DesktopPhase03Domain",
    "description": "The closed vocabularies and shared shapes of the Phase-03 agent runtime: missions, task graphs, agents, claims and evidence.",
    "$comment": "مفردات مغلقة. لا حقل سرّ، ولا عنوان حرّ، ولا سلسلة تفكير مخفية: النتيجة المهيكلة وأسباب القرار فقط.",
    "$defs": {
      "MissionTitle": {
        "title": "MissionTitle",
        "type": "string",
        "minLength": 1,
        "maxLength": 200
      },
      "MissionObjective": {
        "title": "MissionObjective",
        "type": "string",
        "minLength": 1,
        "maxLength": 8000
      },
      "BoundedText": {
        "title": "BoundedText",
        "type": "string",
        "maxLength": 4000,
        "description": "A bounded summary or statement. Bounded so that one message cannot grow the database without limit."
      },
      "MissionState": {
        "title": "MissionState",
        "type": "string",
        "enum": [
          "CREATED",
          "PLANNING",
          "READY",
          "RUNNING",
          "WAITING_FOR_APPROVAL",
          "WAITING_FOR_USER",
          "BLOCKED",
          "VERIFYING",
          "COMPLETED",
          "FAILED",
          "CANCELLED",
          "STOPPED"
        ],
        "description": "Where the mission is in its execution lifecycle. It does not say whether success was proven; CompletionProofStatus answers that separately."
      },
      "CompletionProofStatus": {
        "title": "CompletionProofStatus",
        "type": "string",
        "enum": [
          "NOT_EVALUATED",
          "NOT_PROVEN",
          "PROVEN"
        ],
        "description": "Whether successful completion was actually proven. COMPLETED and NOT_PROVEN coexist deliberately; the two are never merged."
      },
      "MissionPriority": {
        "title": "MissionPriority",
        "type": "string",
        "enum": [
          "LOW",
          "NORMAL",
          "HIGH"
        ],
        "description": "Priority, used only as a deterministic scheduling tiebreak."
      },
      "MissionOrigin": {
        "title": "MissionOrigin",
        "type": "string",
        "enum": [
          "USER",
          "SYSTEM"
        ],
        "description": "Who created the mission. Documentary; it grants no authority."
      },
      "ExecutionMode": {
        "title": "ExecutionMode",
        "type": "string",
        "enum": [
          "SINGLE_AGENT",
          "COORDINATED_MULTI_AGENT"
        ],
        "description": "The two Phase-03 execution modes. There is no swarm mode, because there is no swarm semantics yet."
      },
      "TaskType": {
        "title": "TaskType",
        "type": "string",
        "enum": [
          "PLAN",
          "DESIGN",
          "BUILD",
          "DEBUG",
          "REVIEW",
          "SECURITY_REVIEW",
          "TEST",
          "RESEARCH",
          "SYNTHESIZE"
        ],
        "description": "The closed set of task kinds."
      },
      "TaskState": {
        "title": "TaskState",
        "type": "string",
        "enum": [
          "PENDING",
          "READY",
          "ASSIGNED",
          "RUNNING",
          "WAITING",
          "REVIEW",
          "SUCCEEDED",
          "FAILED",
          "CANCELLED",
          "BLOCKED",
          "INTERRUPTED",
          "UNVERIFIED_DONE"
        ],
        "description": "Task lifecycle state. INTERRUPTED exists because a task that was running when the application stopped must not still read RUNNING after a restart. UNVERIFIED_DONE (ADR-041): the agent said the step is done and no measured tool call belongs to it; it is terminal and never reads as success."
      },
      "DependencyKind": {
        "title": "DependencyKind",
        "type": "string",
        "enum": [
          "REQUIRES_SUCCESS",
          "REQUIRES_COMPLETION"
        ],
        "description": "Explicit dependency semantics. Readiness is decided by these, never by array order."
      },
      "AgentRole": {
        "title": "AgentRole",
        "type": "string",
        "enum": [
          "COORDINATOR",
          "PLANNER",
          "ARCHITECT",
          "BUILDER",
          "DEBUGGER",
          "REVIEWER",
          "SECURITY_REVIEWER",
          "TEST_ENGINEER",
          "RESEARCHER"
        ],
        "description": "A behavioural template. A role is not a permission: naming an agent SECURITY_REVIEWER grants it nothing."
      },
      "AgentState": {
        "title": "AgentState",
        "type": "string",
        "enum": [
          "CREATED",
          "IDLE",
          "WORKING",
          "WAITING",
          "REVIEWING",
          "BLOCKED",
          "COMPLETED",
          "FAILED",
          "CANCELLED",
          "STOPPED"
        ],
        "description": "Agent instance lifecycle state."
      },
      "ClaimType": {
        "title": "ClaimType",
        "type": "string",
        "enum": [
          "FACT",
          "RESULT",
          "COMPLETION",
          "REQUIREMENT_SATISFACTION",
          "ASSUMPTION",
          "RISK",
          "OBSERVATION"
        ],
        "description": "The closed claim vocabulary."
      },
      "ClaimStatus": {
        "title": "ClaimStatus",
        "type": "string",
        "enum": [
          "UNVERIFIED",
          "SUPPORTED",
          "VERIFIED",
          "REFUTED",
          "CONFLICTED",
          "UNKNOWN"
        ],
        "description": "SUPPORTED means evidence exists but the stricter rule did not pass. VERIFIED means a configured verification rule passed. Model confidence never becomes VERIFIED."
      },
      "EvidenceType": {
        "title": "EvidenceType",
        "type": "string",
        "enum": [
          "USER_CONFIRMATION",
          "RUNTIME_MEASUREMENT",
          "TEST_RESULT",
          "TOOL_RESULT",
          "ARTIFACT",
          "SOURCE_DOCUMENT",
          "PROJECT_CONTEXT",
          "PROVIDER_RESPONSE",
          "POLICY_DECISION",
          "AUDIT_EVENT",
          "COMPLETION_PROOF",
          "AGENT_OUTPUT",
          "GRADER_RESULT",
          "MODEL_JUDGMENT"
        ],
        "description": "Closed evidence vocabulary. TOOL_RESULT was added in Phase-04: it is measured, because the tool gateway executed it, and it still does not satisfy a rule that requires a test artefact."
      },
      "MeasurementKind": {
        "title": "MeasurementKind",
        "type": "string",
        "enum": [
          "MEASURED",
          "INFERRED"
        ],
        "description": "Whether the evidence was measured or inferred. Inference is not measurement."
      },
      "AuthorityClass": {
        "title": "AuthorityClass",
        "type": "string",
        "enum": [
          "SYSTEM_POLICY",
          "DIRECT_USER_INSTRUCTION",
          "TRUSTED_RUNTIME_FACT",
          "AGENT_MESSAGE",
          "MODEL_GENERATED",
          "UNTRUSTED_CONTENT"
        ],
        "description": "Where an instruction or fact came from. Only SYSTEM_POLICY and DIRECT_USER_INSTRUCTION may command; an agent message never becomes a user instruction."
      },
      "TaintFlag": {
        "title": "TaintFlag",
        "type": "string",
        "enum": [
          "UNTRUSTED_CONTENT",
          "MODEL_GENERATED",
          "AGENT_RELAYED",
          "UNVERIFIED_CLAIM"
        ],
        "description": "Taint flags merge by union only. Nothing subtracts a flag automatically."
      },
      "RequirementStatus": {
        "title": "RequirementStatus",
        "type": "string",
        "enum": [
          "PENDING",
          "SATISFIED",
          "UNSATISFIED",
          "UNVERIFIED",
          "BLOCKED"
        ],
        "description": "Mission requirement status."
      },
      "BudgetPreset": {
        "title": "BudgetPreset",
        "type": "string",
        "enum": [
          "CONSERVATIVE",
          "BALANCED",
          "EXTENDED",
          "CUSTOM"
        ],
        "description": "Named budget presets. The values each preset expands to are shown to the user; no preset is called best or smart, because nothing measured says it is."
      },
      "ReviewIndependence": {
        "title": "ReviewIndependence",
        "type": "string",
        "enum": [
          "NOT_REVIEWED",
          "SAME_MODEL_REVIEW",
          "INDEPENDENT_MODEL_REVIEW"
        ],
        "description": "Whether a review used a different model. A model reviewing its own output is recorded as SAME_MODEL_REVIEW, never as independent."
      },
      "MissionBudget": {
        "title": "MissionBudget",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "max_wall_clock_ms",
          "max_model_calls",
          "max_input_tokens",
          "max_output_tokens",
          "max_total_tokens",
          "max_tasks",
          "max_agent_instances",
          "max_active_agents",
          "max_concurrent_model_calls",
          "max_delegations",
          "max_delegation_depth",
          "max_retries",
          "max_review_rounds",
          "max_graph_revisions"
        ],
        "properties": {
          "max_wall_clock_ms": {
            "type": "integer",
            "minimum": 1000,
            "maximum": 86400000
          },
          "max_model_calls": {
            "type": "integer",
            "minimum": 1,
            "maximum": 1000
          },
          "max_input_tokens": {
            "type": "integer",
            "minimum": 1,
            "maximum": 100000000
          },
          "max_output_tokens": {
            "type": "integer",
            "minimum": 1,
            "maximum": 100000000
          },
          "max_total_tokens": {
            "type": "integer",
            "minimum": 1,
            "maximum": 200000000
          },
          "max_tasks": {
            "type": "integer",
            "minimum": 1,
            "maximum": 500
          },
          "max_agent_instances": {
            "type": "integer",
            "minimum": 1,
            "maximum": 100
          },
          "max_active_agents": {
            "type": "integer",
            "minimum": 1,
            "maximum": 16
          },
          "max_concurrent_model_calls": {
            "type": "integer",
            "minimum": 1,
            "maximum": 8
          },
          "max_delegations": {
            "type": "integer",
            "minimum": 0,
            "maximum": 100
          },
          "max_delegation_depth": {
            "type": "integer",
            "minimum": 0,
            "maximum": 8
          },
          "max_retries": {
            "type": "integer",
            "minimum": 0,
            "maximum": 10
          },
          "max_review_rounds": {
            "type": "integer",
            "minimum": 0,
            "maximum": 10
          },
          "max_graph_revisions": {
            "type": "integer",
            "minimum": 0,
            "maximum": 100
          },
          "max_tool_calls": {
            "type": "integer",
            "minimum": 0,
            "maximum": 1000
          },
          "max_tool_calls_per_task": {
            "type": "integer",
            "minimum": 0,
            "maximum": 200
          },
          "max_external_side_effects": {
            "type": "integer",
            "minimum": 0,
            "maximum": 100
          },
          "max_network_tool_calls": {
            "type": "integer",
            "minimum": 0,
            "maximum": 500
          },
          "max_tool_runtime_ms": {
            "type": "integer",
            "minimum": 0,
            "maximum": 3600000
          }
        },
        "description": "Every enforced budget dimension. The upper bounds here are contract ceilings, not recommendations; the product default is conservative.",
        "$comment": "كل بُعد يُفرَض بالحجز قبل الإنفاق. السقوف هنا حدود عقد لا قيم مُثلى مُقاسة. أبعاد الأدوات أُضيفت في Phase-04 اختياريةً: حمولة بلا هذه الحقول تبقى صالحة وتأخذ الحدّ المحافظ."
      },
      "RequirementViewV1": {
        "title": "RequirementViewV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "requirement_id",
          "text",
          "verification_rule_id",
          "mandatory",
          "status"
        ],
        "properties": {
          "requirement_id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128
          },
          "text": {
            "type": "string",
            "minLength": 1,
            "maxLength": 2000
          },
          "verification_rule_id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128
          },
          "mandatory": {
            "type": "boolean"
          },
          "status": {
            "$ref": "#/$defs/RequirementStatus"
          },
          "claim_ref": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          }
        }
      },
      "TaskDependencyViewV1": {
        "title": "TaskDependencyViewV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "depends_on",
          "kind"
        ],
        "properties": {
          "depends_on": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "kind": {
            "$ref": "#/$defs/DependencyKind"
          }
        }
      },
      "TaskViewV1": {
        "title": "TaskViewV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "task_id",
          "mission_id",
          "title",
          "task_type",
          "state",
          "dependencies",
          "attempt",
          "max_attempts"
        ],
        "properties": {
          "task_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "title": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200
          },
          "objective": {
            "$ref": "#/$defs/BoundedText"
          },
          "task_type": {
            "$ref": "#/$defs/TaskType"
          },
          "state": {
            "$ref": "#/$defs/TaskState"
          },
          "assigned_agent_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "parent_task_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid",
            "description": "The step this one belongs to: a step of the agent's plan, or a delegated helper's step (ADR-039)."
          },
          "dependencies": {
            "type": "array",
            "maxItems": 64,
            "items": {
              "$ref": "#/$defs/TaskDependencyViewV1"
            }
          },
          "attempt": {
            "type": "integer",
            "minimum": 0,
            "maximum": 100
          },
          "max_attempts": {
            "type": "integer",
            "minimum": 1,
            "maximum": 100
          }
        }
      },
      "AgentViewV1": {
        "title": "AgentViewV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "agent_id",
          "mission_id",
          "role",
          "state",
          "delegation_depth",
          "created_at",
          "last_active_at"
        ],
        "properties": {
          "agent_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "role": {
            "$ref": "#/$defs/AgentRole"
          },
          "state": {
            "$ref": "#/$defs/AgentState"
          },
          "model_id": {
            "type": "string",
            "maxLength": 256,
            "description": "The model this agent was routed to, by registry id. Never an endpoint, never a credential."
          },
          "delegation_depth": {
            "type": "integer",
            "minimum": 0,
            "maximum": 8
          },
          "parent_agent_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "current_task_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "created_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          },
          "last_active_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          }
        }
      },
      "ClaimViewV1": {
        "title": "ClaimViewV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "claim_id",
          "mission_id",
          "agent_id",
          "statement",
          "claim_type",
          "status",
          "evidence_count",
          "counterevidence_count",
          "taint",
          "verification_required",
          "created_at"
        ],
        "properties": {
          "claim_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "task_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "agent_id": {
            "description": "The agent that made the claim, or polaris.runtime for a claim the mission runtime records itself (deliverable and requirement checks).",
            "oneOf": [
              {
                "$ref": "./common/ids.schema.json#/$defs/Uuid"
              },
              {
                "const": "polaris.runtime"
              }
            ]
          },
          "statement": {
            "$ref": "#/$defs/BoundedText"
          },
          "claim_type": {
            "$ref": "#/$defs/ClaimType"
          },
          "status": {
            "$ref": "#/$defs/ClaimStatus"
          },
          "subject": {
            "type": "string",
            "maxLength": 200
          },
          "property": {
            "type": "string",
            "maxLength": 200
          },
          "value": {
            "type": "string",
            "maxLength": 200
          },
          "evidence_count": {
            "type": "integer",
            "minimum": 0,
            "maximum": 1000
          },
          "counterevidence_count": {
            "type": "integer",
            "minimum": 0,
            "maximum": 1000
          },
          "taint": {
            "type": "array",
            "maxItems": 4,
            "uniqueItems": true,
            "items": {
              "$ref": "#/$defs/TaintFlag"
            }
          },
          "verification_required": {
            "type": "boolean"
          },
          "created_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          }
        },
        "description": "A claim as the renderer may see it. There is no confidence percentage, because no measured definition of one exists."
      },
      "EvidenceViewV1": {
        "title": "EvidenceViewV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "evidence_id",
          "mission_id",
          "evidence_type",
          "digest",
          "producer",
          "authority",
          "source_ref",
          "measurement_kind",
          "taint",
          "created_at"
        ],
        "properties": {
          "evidence_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "evidence_type": {
            "$ref": "#/$defs/EvidenceType"
          },
          "digest": {
            "$ref": "./common/ids.schema.json#/$defs/Sha256Hex"
          },
          "producer": {
            "type": "string",
            "minLength": 1,
            "maxLength": 256
          },
          "authority": {
            "$ref": "#/$defs/AuthorityClass"
          },
          "source_ref": {
            "type": "string",
            "minLength": 1,
            "maxLength": 512,
            "description": "Where the evidence came from, as an internal reference. It is not a URL the renderer may choose or the host will fetch."
          },
          "lineage": {
            "type": "array",
            "maxItems": 32,
            "items": {
              "type": "string",
              "maxLength": 512
            },
            "description": "The derivation lineage. Two items sharing a lineage root are one source, not two."
          },
          "measurement_kind": {
            "$ref": "#/$defs/MeasurementKind"
          },
          "taint": {
            "type": "array",
            "maxItems": 4,
            "uniqueItems": true,
            "items": {
              "$ref": "#/$defs/TaintFlag"
            }
          },
          "summary": {
            "$ref": "#/$defs/BoundedText"
          },
          "created_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          }
        }
      },
      "BlockerViewV1": {
        "title": "BlockerViewV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "kind"
        ],
        "properties": {
          "kind": {
            "title": "BlockerKind",
            "type": "string",
            "enum": [
              "UNSATISFIED_REQUIREMENT",
              "UNVERIFIED_REQUIREMENT",
              "CONFLICTED_CLAIM",
              "CRITICAL_POLICY_VIOLATION",
              "NO_MANDATORY_REQUIREMENT",
              "EXECUTION_INCOMPLETE"
            ],
            "description": "Why completion is not proven."
          },
          "detail": {
            "type": "string",
            "maxLength": 512
          }
        }
      },
      "CompletionProofViewV1": {
        "title": "CompletionProofViewV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "status",
          "proof_summary",
          "verified_requirements",
          "unverified_requirements",
          "conflicted_claims",
          "remaining_blockers"
        ],
        "properties": {
          "status": {
            "$ref": "#/$defs/CompletionProofStatus"
          },
          "proof_summary": {
            "$ref": "#/$defs/BoundedText"
          },
          "verified_requirements": {
            "type": "array",
            "maxItems": 200,
            "items": {
              "type": "string",
              "maxLength": 128
            }
          },
          "unverified_requirements": {
            "type": "array",
            "maxItems": 200,
            "items": {
              "type": "string",
              "maxLength": 128
            }
          },
          "conflicted_claims": {
            "type": "array",
            "maxItems": 200,
            "items": {
              "$ref": "./common/ids.schema.json#/$defs/Uuid"
            }
          },
          "remaining_blockers": {
            "type": "array",
            "maxItems": 200,
            "items": {
              "$ref": "#/$defs/BlockerViewV1"
            }
          }
        },
        "description": "The proof side of a mission, always reported next to the lifecycle state and never folded into it."
      },
      "MissionSummaryV1": {
        "title": "MissionSummaryV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "mission_id",
          "title",
          "state",
          "completion_proof_status",
          "created_at",
          "task_count",
          "tasks_succeeded"
        ],
        "properties": {
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "project_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "title": {
            "$ref": "#/$defs/MissionTitle"
          },
          "title_authority": {
            "$ref": "#/$defs/AuthorityClass"
          },
          "state": {
            "$ref": "#/$defs/MissionState"
          },
          "completion_proof_status": {
            "$ref": "#/$defs/CompletionProofStatus"
          },
          "created_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          },
          "task_count": {
            "type": "integer",
            "minimum": 0,
            "maximum": 500
          },
          "tasks_succeeded": {
            "type": "integer",
            "minimum": 0,
            "maximum": 500
          }
        },
        "description": "A mission row. Progress is derived from task states; no percentage is invented when none can be computed."
      },
      "MissionDetailV1": {
        "title": "MissionDetailV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "mission_id",
          "title",
          "objective",
          "origin",
          "execution_mode",
          "priority",
          "state",
          "completion_proof_status",
          "current_revision",
          "budget",
          "requirements",
          "created_at",
          "version"
        ],
        "properties": {
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "project_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "title": {
            "$ref": "#/$defs/MissionTitle"
          },
          "title_authority": {
            "$ref": "#/$defs/AuthorityClass"
          },
          "objective": {
            "$ref": "#/$defs/MissionObjective"
          },
          "origin": {
            "$ref": "#/$defs/MissionOrigin"
          },
          "execution_mode": {
            "$ref": "#/$defs/ExecutionMode"
          },
          "priority": {
            "$ref": "#/$defs/MissionPriority"
          },
          "state": {
            "$ref": "#/$defs/MissionState"
          },
          "completion_proof_status": {
            "$ref": "#/$defs/CompletionProofStatus"
          },
          "current_revision": {
            "type": "integer",
            "minimum": 1,
            "maximum": 1000
          },
          "root_task_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "budget": {
            "$ref": "#/$defs/MissionBudget"
          },
          "requirements": {
            "type": "array",
            "maxItems": 200,
            "items": {
              "$ref": "#/$defs/RequirementViewV1"
            }
          },
          "result_summary": {
            "$ref": "#/$defs/BoundedText"
          },
          "failure_reason": {
            "type": "string",
            "maxLength": 256
          },
          "created_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          },
          "started_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          },
          "completed_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          },
          "version": {
            "type": "integer",
            "minimum": 1,
            "maximum": 1000000
          }
        }
      },
      "SecurityClass": {
        "title": "SecurityClass",
        "type": "string",
        "enum": [
          "STANDARD",
          "SECURITY_SENSITIVE"
        ],
        "description": "Documentary classification of a role. It grants nothing; policy enforcement points decide what is allowed."
      },
      "StopReasonCode": {
        "title": "StopReasonCode",
        "type": "string",
        "enum": [
          "NO_PROGRESS",
          "BUDGET_EXHAUSTED",
          "MODEL_OUTPUT_INVALID",
          "NO_MODEL_ROUTED",
          "TASK_GRAPH_INVALID",
          "MISSION_CANCELLED",
          "DEADLINE_EXCEEDED",
          "PROVIDER_UNAVAILABLE",
          "PROVIDER_CREDIT_EXHAUSTED",
          "DELIVERABLES_INCOMPLETE",
          "TASKS_BLOCKED",
          "TASKS_FAILED",
          "REPEATED_DENIALS",
          "TAMPER_DETECTED",
          "STORAGE_FAILURE"
        ],
        "description": "Why a run stopped before its natural end. A stop reason is a reason code, never internal detail. STORAGE_FAILURE (remediation 2026-10-12): the session log or the resume checkpoint could not be written, so the run stopped before its next side effect."
      },
      "AgentRoleViewV1": {
        "title": "AgentRoleViewV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "agent_type",
          "display_name_key",
          "purpose_key",
          "allowed_task_types",
          "max_delegation_depth",
          "review_eligible",
          "security_class",
          "enabled"
        ],
        "properties": {
          "agent_type": {
            "$ref": "./desktop-p03-domain.schema.json#/$defs/AgentRole"
          },
          "display_name_key": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128
          },
          "purpose_key": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128
          },
          "allowed_task_types": {
            "type": "array",
            "maxItems": 9,
            "uniqueItems": true,
            "items": {
              "$ref": "./desktop-p03-domain.schema.json#/$defs/TaskType"
            }
          },
          "max_delegation_depth": {
            "type": "integer",
            "minimum": 0,
            "maximum": 8
          },
          "review_eligible": {
            "type": "boolean"
          },
          "security_class": {
            "$ref": "./desktop-p03-domain.schema.json#/$defs/SecurityClass"
          },
          "enabled": {
            "type": "boolean"
          }
        },
        "description": "A role descriptor as the Agents screen shows it. There is no productivity score, because none is measured."
      },
      "MissionRunReportV1": {
        "title": "MissionRunReportV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "mission_state",
          "tasks_succeeded",
          "tasks_failed",
          "tasks_blocked",
          "model_calls",
          "total_tokens",
          "claims",
          "verified_claims",
          "review_independence"
        ],
        "properties": {
          "mission_state": {
            "$ref": "./desktop-p03-domain.schema.json#/$defs/MissionState"
          },
          "tasks_succeeded": {
            "type": "integer",
            "minimum": 0,
            "maximum": 500
          },
          "tasks_failed": {
            "type": "integer",
            "minimum": 0,
            "maximum": 500
          },
          "tasks_blocked": {
            "type": "integer",
            "minimum": 0,
            "maximum": 500
          },
          "model_calls": {
            "type": "integer",
            "minimum": 0,
            "maximum": 1000
          },
          "total_tokens": {
            "type": "integer",
            "minimum": 0,
            "maximum": 200000000
          },
          "claims": {
            "type": "integer",
            "minimum": 0,
            "maximum": 10000
          },
          "verified_claims": {
            "type": "integer",
            "minimum": 0,
            "maximum": 10000
          },
          "review_independence": {
            "$ref": "./desktop-p03-domain.schema.json#/$defs/ReviewIndependence"
          },
          "stop_reason": {
            "$ref": "./desktop-p03-domain.schema.json#/$defs/StopReasonCode"
          },
          "tool_proposals": {
            "type": "integer",
            "minimum": 0,
            "maximum": 10000
          },
          "tool_calls_executed": {
            "type": "integer",
            "minimum": 0,
            "maximum": 10000
          },
          "tool_calls_denied": {
            "type": "integer",
            "minimum": 0,
            "maximum": 10000
          },
          "tool_calls_awaiting_approval": {
            "type": "integer",
            "minimum": 0,
            "maximum": 10000
          },
          "delegations_requested": {
            "type": "integer",
            "minimum": 0,
            "maximum": 1000
          },
          "delegations_executed": {
            "type": "integer",
            "minimum": 0,
            "maximum": 1000
          },
          "agent_messages": {
            "type": "integer",
            "minimum": 0,
            "maximum": 10000
          }
        },
        "description": "What one orchestration run actually did. Counts are measured, not estimated. The tool and delegation counts were added in Phase-04 as optional fields, so a Phase-03 result stays valid."
      }
    }
  } as unknown as SchemaDocument,
  "desktop-p03-request.v1.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "DesktopPhase03RequestPayloadV1",
    "description": "The closed set of request payloads the ten Phase-03 operations accept. Every payload is a closed object; none can carry an operation name, a URL, a header, or a credential.",
    "$comment": "لا اسم عملية داخل الحمولة، ولا عنوان حرّ، ولا سرّ. الوكيل لا يصل إلى هذه الطبقة أصلًا: العارض وحده يتكلّم هنا.",
    "anyOf": [
      {
        "$ref": "#/$defs/MissionListRequestV1"
      },
      {
        "$ref": "#/$defs/MissionGetRequestV1"
      },
      {
        "$ref": "#/$defs/MissionCreateRequestV1"
      },
      {
        "$ref": "#/$defs/MissionStartRequestV1"
      },
      {
        "$ref": "#/$defs/MissionCancelRequestV1"
      },
      {
        "$ref": "#/$defs/MissionResumeRequestV1"
      },
      {
        "$ref": "#/$defs/TaskListRequestV1"
      },
      {
        "$ref": "#/$defs/AgentListRequestV1"
      },
      {
        "$ref": "#/$defs/ClaimListRequestV1"
      },
      {
        "$ref": "#/$defs/EvidenceListRequestV1"
      }
    ],
    "$defs": {
      "MissionListRequestV1": {
        "title": "MissionListRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [],
        "properties": {
          "project_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          }
        },
        "description": "Lists missions, optionally narrowed to one project. No side effect."
      },
      "MissionGetRequestV1": {
        "title": "MissionGetRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "mission_id"
        ],
        "properties": {
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          }
        }
      },
      "MissionCreateRequestV1": {
        "title": "MissionCreateRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "title",
          "objective"
        ],
        "properties": {
          "title": {
            "$ref": "./desktop-p03-domain.schema.json#/$defs/MissionTitle"
          },
          "objective": {
            "$ref": "./desktop-p03-domain.schema.json#/$defs/MissionObjective"
          },
          "project_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "execution_mode": {
            "$ref": "./desktop-p03-domain.schema.json#/$defs/ExecutionMode"
          },
          "priority": {
            "$ref": "./desktop-p03-domain.schema.json#/$defs/MissionPriority"
          },
          "budget_preset": {
            "$ref": "./desktop-p03-domain.schema.json#/$defs/BudgetPreset"
          },
          "budget": {
            "$ref": "./desktop-p03-domain.schema.json#/$defs/MissionBudget"
          },
          "requirements": {
            "type": "array",
            "maxItems": 50,
            "items": {
              "title": "MissionRequirementInputV1",
              "type": "object",
              "additionalProperties": false,
              "required": [
                "requirement_id",
                "text",
                "mandatory"
              ],
              "properties": {
                "requirement_id": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 128
                },
                "text": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 2000
                },
                "mandatory": {
                  "type": "boolean"
                },
                "verification_rule_id": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 128
                }
              }
            }
          }
        },
        "description": "Creates a mission. It does not start it: creation and execution are separate operations so that starting work is always an explicit act.",
        "$comment": "الإنشاء لا يشغّل. بدء التنفيذ عملية مستقلة بمفتاح idempotency خاص بها."
      },
      "MissionStartRequestV1": {
        "title": "MissionStartRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "mission_id"
        ],
        "properties": {
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          }
        },
        "description": "Starts orchestration for one mission that this session owns."
      },
      "MissionCancelRequestV1": {
        "title": "MissionCancelRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "mission_id"
        ],
        "properties": {
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          }
        },
        "description": "Cancels one mission. There is no cancel-all."
      },
      "MissionResumeRequestV1": {
        "title": "MissionResumeRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "mission_id"
        ],
        "properties": {
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          }
        },
        "description": "Resumes a mission that a restart left blocked. Resuming never replays a completed side effect."
      },
      "TaskListRequestV1": {
        "title": "TaskListRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "mission_id"
        ],
        "properties": {
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          }
        }
      },
      "AgentListRequestV1": {
        "title": "AgentListRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [],
        "properties": {
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          }
        },
        "description": "Lists role descriptors always, and the agent instances of one mission when a mission is named."
      },
      "ClaimListRequestV1": {
        "title": "ClaimListRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "mission_id"
        ],
        "properties": {
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          }
        }
      },
      "EvidenceListRequestV1": {
        "title": "EvidenceListRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "mission_id"
        ],
        "properties": {
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          }
        }
      }
    }
  } as unknown as SchemaDocument,
  "desktop-p03-result.v1.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "DesktopPhase03ResultPayloadV1",
    "description": "The closed set of result payloads the ten Phase-03 operations return. No result carries a secret, a raw provider body, a filesystem path outside a declared reference, or hidden model reasoning.",
    "$comment": "لا سرّ، ولا جسد مزوّد خام، ولا سلسلة تفكير. الحالة والإثبات يسافران معًا دائمًا.",
    "anyOf": [
      {
        "$ref": "#/$defs/MissionListResultV1"
      },
      {
        "$ref": "#/$defs/MissionGetResultV1"
      },
      {
        "$ref": "#/$defs/MissionCreateResultV1"
      },
      {
        "$ref": "#/$defs/MissionStartResultV1"
      },
      {
        "$ref": "#/$defs/MissionCancelResultV1"
      },
      {
        "$ref": "#/$defs/MissionResumeResultV1"
      },
      {
        "$ref": "#/$defs/TaskListResultV1"
      },
      {
        "$ref": "#/$defs/AgentListResultV1"
      },
      {
        "$ref": "#/$defs/ClaimListResultV1"
      },
      {
        "$ref": "#/$defs/EvidenceListResultV1"
      }
    ],
    "$defs": {
      "MissionListResultV1": {
        "title": "MissionListResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "missions"
        ],
        "properties": {
          "missions": {
            "type": "array",
            "maxItems": 500,
            "items": {
              "$ref": "./desktop-p03-domain.schema.json#/$defs/MissionSummaryV1"
            }
          }
        }
      },
      "MissionGetResultV1": {
        "title": "MissionGetResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "mission",
          "completion_proof"
        ],
        "properties": {
          "mission": {
            "$ref": "./desktop-p03-domain.schema.json#/$defs/MissionDetailV1"
          },
          "completion_proof": {
            "$ref": "./desktop-p03-domain.schema.json#/$defs/CompletionProofViewV1"
          }
        },
        "description": "The mission and its proof, always together. Reading one without the other is how a completed mission gets mistaken for a proven one."
      },
      "MissionCreateResultV1": {
        "title": "MissionCreateResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "mission_id",
          "state",
          "completion_proof_status",
          "created_at"
        ],
        "properties": {
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "state": {
            "$ref": "./desktop-p03-domain.schema.json#/$defs/MissionState"
          },
          "completion_proof_status": {
            "$ref": "./desktop-p03-domain.schema.json#/$defs/CompletionProofStatus"
          },
          "created_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          }
        }
      },
      "MissionStartResultV1": {
        "title": "MissionStartResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "mission_id",
          "state",
          "completion_proof",
          "report"
        ],
        "properties": {
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "state": {
            "$ref": "./desktop-p03-domain.schema.json#/$defs/MissionState"
          },
          "completion_proof": {
            "$ref": "./desktop-p03-domain.schema.json#/$defs/CompletionProofViewV1"
          },
          "report": {
            "$ref": "./desktop-p03-domain.schema.json#/$defs/MissionRunReportV1"
          }
        }
      },
      "MissionCancelResultV1": {
        "title": "MissionCancelResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "mission_id",
          "state"
        ],
        "properties": {
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "state": {
            "$ref": "./desktop-p03-domain.schema.json#/$defs/MissionState"
          }
        }
      },
      "MissionResumeResultV1": {
        "title": "MissionResumeResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "mission_id",
          "state",
          "tasks_interrupted"
        ],
        "properties": {
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "state": {
            "$ref": "./desktop-p03-domain.schema.json#/$defs/MissionState"
          },
          "tasks_interrupted": {
            "type": "integer",
            "minimum": 0,
            "maximum": 500
          }
        },
        "description": "Resuming reports how many tasks a restart had interrupted. It never reports interrupted work as finished."
      },
      "TaskListResultV1": {
        "title": "TaskListResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "mission_id",
          "graph_revision",
          "tasks",
          "ready"
        ],
        "properties": {
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "graph_revision": {
            "type": "integer",
            "minimum": 0,
            "maximum": 100000
          },
          "tasks": {
            "type": "array",
            "maxItems": 500,
            "items": {
              "$ref": "./desktop-p03-domain.schema.json#/$defs/TaskViewV1"
            }
          },
          "ready": {
            "type": "array",
            "maxItems": 500,
            "items": {
              "$ref": "./common/ids.schema.json#/$defs/Uuid"
            },
            "description": "The deterministic ready set at this revision, in scheduling order."
          }
        }
      },
      "AgentListResultV1": {
        "title": "AgentListResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "roles",
          "instances"
        ],
        "properties": {
          "roles": {
            "type": "array",
            "maxItems": 32,
            "items": {
              "$ref": "./desktop-p03-domain.schema.json#/$defs/AgentRoleViewV1"
            }
          },
          "instances": {
            "type": "array",
            "maxItems": 500,
            "items": {
              "$ref": "./desktop-p03-domain.schema.json#/$defs/AgentViewV1"
            }
          }
        }
      },
      "ClaimListResultV1": {
        "title": "ClaimListResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "mission_id",
          "claims"
        ],
        "properties": {
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "claims": {
            "type": "array",
            "maxItems": 2000,
            "items": {
              "$ref": "./desktop-p03-domain.schema.json#/$defs/ClaimViewV1"
            }
          }
        }
      },
      "EvidenceListResultV1": {
        "title": "EvidenceListResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "mission_id",
          "evidence"
        ],
        "properties": {
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "evidence": {
            "type": "array",
            "maxItems": 2000,
            "items": {
              "$ref": "./desktop-p03-domain.schema.json#/$defs/EvidenceViewV1"
            }
          }
        }
      }
    }
  } as unknown as SchemaDocument,
  "desktop-p04-domain.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "DesktopPhase04Domain",
    "description": "The closed vocabularies and shared shapes of the Phase-04 capability layer: skills, the tool registry, the tool gateway, MCP servers, tool approvals and tool evidence.",
    "$comment": "مفردات مغلقة. لا اسم أداة حرّ، ولا وجهة حرّة، ولا سرّ. وصف أداة MCP بيانات غير موثوقة، لا تعليمة.",
    "$defs": {
      "SkillId": {
        "title": "SkillId",
        "type": "string",
        "minLength": 3,
        "maxLength": 120,
        "pattern": "^[a-z0-9][a-z0-9._-]{2,119}$",
        "description": "Stable identifier of a skill. Lowercase and bounded; it is never free text from a model."
      },
      "ToolId": {
        "title": "ToolId",
        "type": "string",
        "minLength": 3,
        "maxLength": 160,
        "pattern": "^[a-z0-9][a-z0-9._:-]{2,159}$",
        "description": "Stable identifier of a registered tool. A tool that is not in the registry under this exact identifier cannot be invoked."
      },
      "McpServerId": {
        "title": "McpServerId",
        "$ref": "./common/ids.schema.json#/$defs/Uuid",
        "description": "Identifier the host issues for a registered MCP server. The server never chooses it."
      },
      "BoundedLabel": {
        "title": "BoundedLabel",
        "type": "string",
        "minLength": 1,
        "maxLength": 200
      },
      "BoundedDescription": {
        "title": "BoundedDescription",
        "type": "string",
        "maxLength": 2000,
        "description": "A bounded description. For an MCP-supplied description this is untrusted data that is displayed, never merged into an instruction."
      },
      "SkillSource": {
        "title": "SkillSource",
        "type": "string",
        "enum": [
          "BUILT_IN",
          "USER_DEFINED",
          "MCP_BACKED"
        ],
        "description": "Where the skill definition came from. No source grants authority; the source only records provenance."
      },
      "RiskClass": {
        "title": "RiskClass",
        "type": "string",
        "enum": [
          "LOW",
          "MODERATE",
          "HIGH",
          "CRITICAL"
        ]
      },
      "ToolProvider": {
        "title": "ToolProvider",
        "type": "string",
        "enum": [
          "BUILT_IN",
          "MCP"
        ]
      },
      "ToolTrustClass": {
        "title": "ToolTrustClass",
        "type": "string",
        "enum": [
          "TRUSTED_RUNTIME",
          "MCP_UNTRUSTED"
        ],
        "description": "TRUSTED_RUNTIME describes the adapter POLARIS itself implements. MCP_UNTRUSTED marks everything a server supplied: its metadata and its output are data."
      },
      "ToolEffect": {
        "title": "ToolEffect",
        "type": "string",
        "enum": [
          "LOCAL_COMPUTE",
          "READ_LOCAL",
          "WRITE_LOCAL",
          "NETWORK_EGRESS",
          "PROCESS_EXECUTION",
          "SECRET_ACCESS",
          "DATABASE_READ",
          "DATABASE_WRITE",
          "EXTERNAL_SIDE_EFFECT",
          "DESKTOP_INPUT",
          "WORKSPACE_READ",
          "WORKSPACE_WRITE",
          "SANDBOXED_EXECUTION"
        ],
        "description": "What a tool can cause. A tool that can change anything indirectly is not read-only, and declares every effect it can reach. DESKTOP_INPUT (added by Phase-05) is input to a window the user granted to one mission; it is not read-only, and a destructive or unknown target raises it to EXTERNAL_SIDE_EFFECT. WORKSPACE_READ, WORKSPACE_WRITE and SANDBOXED_EXECUTION (added by Phase-08) are confined to one mission workspace and one AppContainer sandbox; they grant nothing outside them, and anything that leaves them is declared with the effect it reaches (WRITE_LOCAL, NETWORK_EGRESS, EXTERNAL_SIDE_EFFECT)."
      },
      "NetworkPolicy": {
        "title": "NetworkPolicy",
        "type": "string",
        "enum": [
          "NONE",
          "LOOPBACK_ONLY",
          "WEB_NAVIGATION_POLICY",
          "CONNECTOR_EGRESS_POLICY",
          "MCP_REGISTERED_HTTPS"
        ],
        "description": "The network a tool may reach. No tool is granted free remote egress. LOOPBACK_ONLY is the loopback interface. WEB_NAVIGATION_POLICY (added by Phase-05) is held only by the built-in, trusted browser tools: http and https to public hosts on web ports, every name resolved and every address checked at connect time, every redirect re-checked, and loopback, private, link-local and metadata destinations refused. An MCP or untrusted tool can never hold it. CONNECTOR_EGRESS_POLICY (added by Phase-06) is held only by built-in, trusted connector tools: the host, path template and method come from the connector the user registered, public destinations are resolved and checked at connect time over HTTPS, loopback is literal, redirects are never followed, and the connector gateway enforces all of it. An MCP or untrusted tool can never hold it. MCP_REGISTERED_HTTPS (added by Phase-06) is held only by an untrusted MCP tool of a REMOTE_HTTPS server and always comes with EXTERNAL_SIDE_EFFECT, so every call waits for a human decision; public destinations are resolved and checked at connect time."
      },
      "ToolInvocationStatus": {
        "title": "ToolInvocationStatus",
        "type": "string",
        "enum": [
          "SUCCEEDED",
          "FAILED",
          "DENIED",
          "TIMED_OUT",
          "CANCELLED",
          "AWAITING_APPROVAL"
        ]
      },
      "ToolDenialReason": {
        "title": "ToolDenialReason",
        "type": "string",
        "enum": [
          "UNKNOWN_TOOL",
          "TOOL_DISABLED",
          "SKILL_DISABLED",
          "SKILL_DOES_NOT_ALLOW_TOOL",
          "ARGUMENTS_INVALID",
          "CAPABILITY_MISSING",
          "EFFECT_NOT_PERMITTED",
          "NETWORK_POLICY_DENIED",
          "APPROVAL_REQUIRED",
          "APPROVAL_MISSING",
          "APPROVAL_MISMATCH",
          "APPROVAL_EXPIRED",
          "APPROVAL_ALREADY_USED",
          "APPROVAL_DENIED",
          "BUDGET_EXHAUSTED",
          "CROSS_MISSION_DENIED",
          "SERVER_DISABLED",
          "SERVER_UNREACHABLE",
          "SCHEMA_DRIFT",
          "RESULT_TOO_LARGE",
          "RESULT_MALFORMED",
          "SECRET_REQUESTED",
          "CANCELLED"
        ],
        "description": "Why the gateway refused or ended an invocation. Closed: a refusal is always one of these, never free prose."
      },
      "ApprovalDecision": {
        "title": "ApprovalDecision",
        "type": "string",
        "enum": [
          "GRANT",
          "DENY"
        ]
      },
      "ApprovalStatus": {
        "title": "ApprovalStatus",
        "type": "string",
        "enum": [
          "PENDING",
          "GRANTED",
          "DENIED",
          "EXPIRED",
          "CONSUMED"
        ]
      },
      "McpServerState": {
        "title": "McpServerState",
        "type": "string",
        "enum": [
          "REGISTERED",
          "ENABLED",
          "DISABLED",
          "UNREACHABLE"
        ]
      },
      "McpTransport": {
        "title": "McpTransport",
        "type": "string",
        "enum": [
          "LOOPBACK_HTTP",
          "REMOTE_HTTPS"
        ],
        "description": "LOOPBACK_HTTP: a server on the loopback interface. REMOTE_HTTPS (added by Phase-06): a server the user registered on a public https address, resolved and checked at every connection; its tools carry EXTERNAL_SIDE_EFFECT and wait for a human decision on every call. A process-spawning transport (STDIO) is PROCESS_EXECUTION and is deliberately out of scope."
      },
      "ToolBudgetV1": {
        "title": "ToolBudgetV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "max_tool_calls",
          "max_tool_calls_per_task",
          "max_external_side_effects",
          "max_network_tool_calls",
          "max_tool_runtime_ms"
        ],
        "properties": {
          "max_tool_calls": {
            "type": "integer",
            "minimum": 0,
            "maximum": 1000
          },
          "max_tool_calls_per_task": {
            "type": "integer",
            "minimum": 0,
            "maximum": 200
          },
          "max_external_side_effects": {
            "type": "integer",
            "minimum": 0,
            "maximum": 100
          },
          "max_network_tool_calls": {
            "type": "integer",
            "minimum": 0,
            "maximum": 500
          },
          "max_tool_runtime_ms": {
            "type": "integer",
            "minimum": 0,
            "maximum": 3600000
          }
        },
        "description": "Every tool budget dimension, checked by reservation before the call, never after it."
      },
      "ToolBudgetUsageV1": {
        "title": "ToolBudgetUsageV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "tool_calls",
          "external_side_effects",
          "network_tool_calls",
          "tool_runtime_ms"
        ],
        "properties": {
          "tool_calls": {
            "type": "integer",
            "minimum": 0
          },
          "external_side_effects": {
            "type": "integer",
            "minimum": 0
          },
          "network_tool_calls": {
            "type": "integer",
            "minimum": 0
          },
          "tool_runtime_ms": {
            "type": "integer",
            "minimum": 0
          }
        }
      },
      "SkillViewV1": {
        "title": "SkillViewV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "skill_id",
          "name",
          "description",
          "version",
          "enabled",
          "required_capabilities",
          "allowed_tools",
          "input_schema_ref",
          "output_schema_ref",
          "risk_class",
          "source",
          "created_at",
          "updated_at"
        ],
        "properties": {
          "skill_id": {
            "$ref": "#/$defs/SkillId"
          },
          "name": {
            "$ref": "#/$defs/BoundedLabel"
          },
          "description": {
            "$ref": "#/$defs/BoundedDescription"
          },
          "version": {
            "$ref": "./common/ids.schema.json#/$defs/SemVer"
          },
          "enabled": {
            "type": "boolean"
          },
          "required_capabilities": {
            "type": "array",
            "maxItems": 32,
            "items": {
              "$ref": "#/$defs/BoundedLabel"
            }
          },
          "allowed_tools": {
            "type": "array",
            "maxItems": 64,
            "items": {
              "$ref": "#/$defs/ToolId"
            },
            "description": "The only tools a task running under this skill may propose. A tool outside this list is denied even when it exists and is enabled."
          },
          "input_schema_ref": {
            "$ref": "#/$defs/BoundedLabel"
          },
          "output_schema_ref": {
            "$ref": "#/$defs/BoundedLabel"
          },
          "risk_class": {
            "$ref": "#/$defs/RiskClass"
          },
          "source": {
            "$ref": "#/$defs/SkillSource"
          },
          "created_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          },
          "updated_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          }
        }
      },
      "ToolViewV1": {
        "title": "ToolViewV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "tool_id",
          "provider",
          "name",
          "description",
          "effects",
          "required_capabilities",
          "risk",
          "requires_approval",
          "network_policy",
          "enabled",
          "trust_class",
          "input_schema_ref",
          "output_schema_ref",
          "provenance"
        ],
        "properties": {
          "tool_id": {
            "$ref": "#/$defs/ToolId"
          },
          "provider": {
            "$ref": "#/$defs/ToolProvider"
          },
          "name": {
            "$ref": "#/$defs/BoundedLabel"
          },
          "description": {
            "$ref": "#/$defs/BoundedDescription"
          },
          "effects": {
            "type": "array",
            "minItems": 1,
            "maxItems": 10,
            "items": {
              "$ref": "#/$defs/ToolEffect"
            }
          },
          "required_capabilities": {
            "type": "array",
            "maxItems": 32,
            "items": {
              "$ref": "#/$defs/BoundedLabel"
            }
          },
          "risk": {
            "$ref": "#/$defs/RiskClass"
          },
          "requires_approval": {
            "type": "boolean"
          },
          "network_policy": {
            "$ref": "#/$defs/NetworkPolicy"
          },
          "enabled": {
            "type": "boolean"
          },
          "trust_class": {
            "$ref": "#/$defs/ToolTrustClass"
          },
          "input_schema_ref": {
            "$ref": "#/$defs/BoundedLabel"
          },
          "output_schema_ref": {
            "$ref": "#/$defs/BoundedLabel"
          },
          "provenance": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "origin",
              "registered_at"
            ],
            "properties": {
              "origin": {
                "$ref": "#/$defs/BoundedLabel"
              },
              "server_id": {
                "$ref": "#/$defs/McpServerId"
              },
              "server_name": {
                "$ref": "#/$defs/BoundedLabel"
              },
              "declared_effects": {
                "type": "array",
                "maxItems": 10,
                "items": {
                  "$ref": "#/$defs/ToolEffect"
                },
                "description": "What the server asked for. It is a request, never a grant: the effective effects are the intersection with what the user granted the server."
              },
              "schema_digest": {
                "$ref": "./common/ids.schema.json#/$defs/Sha256Hex"
              },
              "registered_at": {
                "$ref": "./common/ids.schema.json#/$defs/Timestamp"
              }
            }
          }
        }
      },
      "McpServerViewV1": {
        "title": "McpServerViewV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "server_id",
          "name",
          "endpoint",
          "transport",
          "state",
          "granted_effects",
          "tool_count",
          "registered_at"
        ],
        "properties": {
          "server_id": {
            "$ref": "#/$defs/McpServerId"
          },
          "name": {
            "$ref": "#/$defs/BoundedLabel"
          },
          "endpoint": {
            "type": "string",
            "maxLength": 300,
            "description": "The loopback endpoint as the host resolved it. It carries no credential because a tool server is never given one."
          },
          "transport": {
            "$ref": "#/$defs/McpTransport"
          },
          "state": {
            "$ref": "#/$defs/McpServerState"
          },
          "granted_effects": {
            "type": "array",
            "maxItems": 10,
            "items": {
              "$ref": "#/$defs/ToolEffect"
            }
          },
          "tool_count": {
            "type": "integer",
            "minimum": 0,
            "maximum": 1000
          },
          "rejected_tool_count": {
            "type": "integer",
            "minimum": 0,
            "maximum": 1000
          },
          "last_error": {
            "$ref": "#/$defs/ToolDenialReason"
          },
          "last_refresh_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          },
          "registered_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          }
        }
      },
      "ToolInvocationViewV1": {
        "title": "ToolInvocationViewV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "invocation_id",
          "mission_id",
          "tool_id",
          "status",
          "effects",
          "arguments_digest",
          "started_at",
          "duration_ms"
        ],
        "properties": {
          "invocation_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "task_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "agent_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "skill_id": {
            "$ref": "#/$defs/SkillId"
          },
          "tool_id": {
            "$ref": "#/$defs/ToolId"
          },
          "status": {
            "$ref": "#/$defs/ToolInvocationStatus"
          },
          "denial_reason": {
            "$ref": "#/$defs/ToolDenialReason"
          },
          "effects": {
            "type": "array",
            "maxItems": 10,
            "items": {
              "$ref": "#/$defs/ToolEffect"
            }
          },
          "arguments_digest": {
            "$ref": "./common/ids.schema.json#/$defs/Sha256Hex"
          },
          "result_digest": {
            "$ref": "./common/ids.schema.json#/$defs/Sha256Hex"
          },
          "evidence_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "approval_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "summary": {
            "$ref": "#/$defs/BoundedDescription"
          },
          "started_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          },
          "duration_ms": {
            "type": "integer",
            "minimum": 0
          }
        },
        "description": "One record of one attempt to use a tool. A denied attempt is recorded exactly like a successful one; silence is never the record of a refusal."
      },
      "ApprovalViewV1": {
        "title": "ApprovalViewV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "approval_id",
          "mission_id",
          "tool_id",
          "effects",
          "arguments_digest",
          "status",
          "requested_at",
          "expires_at"
        ],
        "properties": {
          "approval_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "task_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "tool_id": {
            "$ref": "#/$defs/ToolId"
          },
          "skill_id": {
            "$ref": "#/$defs/SkillId"
          },
          "effects": {
            "type": "array",
            "maxItems": 10,
            "items": {
              "$ref": "#/$defs/ToolEffect"
            }
          },
          "arguments_digest": {
            "$ref": "./common/ids.schema.json#/$defs/Sha256Hex"
          },
          "arguments_preview": {
            "$ref": "#/$defs/BoundedDescription"
          },
          "reason": {
            "$ref": "#/$defs/BoundedDescription"
          },
          "status": {
            "$ref": "#/$defs/ApprovalStatus"
          },
          "requested_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          },
          "decided_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          },
          "expires_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          },
          "context": {
            "title": "ApprovalContextV1",
            "type": "object",
            "additionalProperties": false,
            "required": [
              "agent_id",
              "action",
              "target",
              "expected_effect",
              "risk",
              "arguments_summary"
            ],
            "properties": {
              "agent_id": {
                "$ref": "./common/ids.schema.json#/$defs/Uuid"
              },
              "action": {
                "type": "string",
                "pattern": "^[A-Z][A-Z0-9_]{1,40}$"
              },
              "target": {
                "type": "string",
                "maxLength": 300
              },
              "expected_effect": {
                "type": "string",
                "maxLength": 400
              },
              "risk": {
                "$ref": "#/$defs/RiskClass"
              },
              "arguments_summary": {
                "type": "string",
                "maxLength": 400
              }
            },
            "description": "A trusted summary of what approving would allow, written by the runtime from its own state (session, page, window, element), never from model prose. Optional: Phase-04 tools do not write it."
          }
        },
        "description": "An approval is bound to one mission, one task, one tool, one arguments digest, one effect set and one expiry. It cannot be replayed for anything else."
      },
      "MissionToolSummaryV1": {
        "title": "MissionToolSummaryV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "mission_id",
          "invocations",
          "skills_used",
          "tools_used",
          "budget",
          "usage"
        ],
        "properties": {
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "invocations": {
            "type": "array",
            "maxItems": 500,
            "items": {
              "$ref": "#/$defs/ToolInvocationViewV1"
            }
          },
          "skills_used": {
            "type": "array",
            "maxItems": 64,
            "items": {
              "$ref": "#/$defs/SkillId"
            }
          },
          "tools_used": {
            "type": "array",
            "maxItems": 64,
            "items": {
              "$ref": "#/$defs/ToolId"
            }
          },
          "budget": {
            "$ref": "#/$defs/ToolBudgetV1"
          },
          "usage": {
            "$ref": "#/$defs/ToolBudgetUsageV1"
          },
          "pending_approvals": {
            "type": "integer",
            "minimum": 0
          }
        }
      }
    }
  } as unknown as SchemaDocument,
  "desktop-p04-request.v1.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "DesktopPhase04RequestPayloadV1",
    "description": "The closed set of request payloads the twelve Phase-04 operations accept. No payload can name a tool that is not registered, carry a raw command, name a remote destination, or carry a credential.",
    "$comment": "لا تنفيذ أداة من العارض، ولا نداء MCP حرّ، ولا سرّ. الموافقة تُجاب بمعرّفها لا بمحتواها.",
    "anyOf": [
      {
        "$ref": "#/$defs/SkillListRequestV1"
      },
      {
        "$ref": "#/$defs/SkillGetRequestV1"
      },
      {
        "$ref": "#/$defs/SkillConfigureRequestV1"
      },
      {
        "$ref": "#/$defs/ToolListRequestV1"
      },
      {
        "$ref": "#/$defs/ToolGetRequestV1"
      },
      {
        "$ref": "#/$defs/ToolActivityListRequestV1"
      },
      {
        "$ref": "#/$defs/McpListRequestV1"
      },
      {
        "$ref": "#/$defs/McpRegisterRequestV1"
      },
      {
        "$ref": "#/$defs/McpConfigureRequestV1"
      },
      {
        "$ref": "#/$defs/McpRefreshRequestV1"
      },
      {
        "$ref": "#/$defs/ApprovalListRequestV1"
      },
      {
        "$ref": "#/$defs/ToolApprovalRespondRequestV1"
      }
    ],
    "$defs": {
      "SkillListRequestV1": {
        "title": "SkillListRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [],
        "properties": {},
        "description": "Lists every skill the host knows, enabled or not. No side effect."
      },
      "SkillGetRequestV1": {
        "title": "SkillGetRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "skill_id"
        ],
        "properties": {
          "skill_id": {
            "$ref": "./desktop-p04-domain.schema.json#/$defs/SkillId"
          }
        }
      },
      "SkillConfigureRequestV1": {
        "title": "SkillConfigureRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "skill_id",
          "enabled"
        ],
        "properties": {
          "skill_id": {
            "$ref": "./desktop-p04-domain.schema.json#/$defs/SkillId"
          },
          "enabled": {
            "type": "boolean"
          }
        },
        "description": "Enables or disables a known skill. It cannot create a skill, widen its allowed tools, or change its risk class."
      },
      "ToolListRequestV1": {
        "title": "ToolListRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [],
        "properties": {
          "provider": {
            "$ref": "./desktop-p04-domain.schema.json#/$defs/ToolProvider"
          },
          "skill_id": {
            "$ref": "./desktop-p04-domain.schema.json#/$defs/SkillId"
          }
        }
      },
      "ToolGetRequestV1": {
        "title": "ToolGetRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "tool_id"
        ],
        "properties": {
          "tool_id": {
            "$ref": "./desktop-p04-domain.schema.json#/$defs/ToolId"
          }
        },
        "description": "Reads one registered tool descriptor. Reading a descriptor is not permission to invoke it, and this operation performs no invocation."
      },
      "ToolActivityListRequestV1": {
        "title": "ToolActivityListRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [],
        "properties": {
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "limit": {
            "type": "integer",
            "minimum": 1,
            "maximum": 500
          }
        }
      },
      "McpListRequestV1": {
        "title": "McpListRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [],
        "properties": {}
      },
      "McpRegisterRequestV1": {
        "title": "McpRegisterRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "name",
          "endpoint"
        ],
        "properties": {
          "name": {
            "$ref": "./desktop-p04-domain.schema.json#/$defs/BoundedLabel"
          },
          "endpoint": {
            "type": "string",
            "minLength": 8,
            "maxLength": 300,
            "pattern": "^(http://(127\\.0\\.0\\.1|localhost|\\[::1\\])(:[0-9]{1,5})?(/[A-Za-z0-9._~/-]*)?|https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[A-Za-z0-9._~/-]*)?)$",
            "description": "A loopback endpoint, or (Phase-06) a public https endpoint without credentials, query or fragment. The pattern is a first gate; the host resolves the endpoint again, refuses private, link-local and metadata addresses, and checks every address at connect time."
          },
          "transport": {
            "$ref": "./desktop-p04-domain.schema.json#/$defs/McpTransport"
          },
          "granted_effects": {
            "type": "array",
            "maxItems": 9,
            "items": {
              "$ref": "./desktop-p04-domain.schema.json#/$defs/ToolEffect"
            },
            "description": "The ceiling the user grants this server. A tool from this server can never hold an effect outside this set, whatever the server declares."
          }
        },
        "description": "Registers an MCP server. Registration alone discovers nothing and grants nothing beyond this ceiling."
      },
      "McpConfigureRequestV1": {
        "title": "McpConfigureRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "server_id",
          "enabled"
        ],
        "properties": {
          "server_id": {
            "$ref": "./desktop-p04-domain.schema.json#/$defs/McpServerId"
          },
          "enabled": {
            "type": "boolean"
          }
        }
      },
      "McpRefreshRequestV1": {
        "title": "McpRefreshRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "server_id"
        ],
        "properties": {
          "server_id": {
            "$ref": "./desktop-p04-domain.schema.json#/$defs/McpServerId"
          }
        },
        "description": "Re-discovers the tools of one server. Every discovered tool is validated again; a server that changed a tool definition has its old descriptor replaced only after the new one passes."
      },
      "ApprovalListRequestV1": {
        "title": "ApprovalListRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [],
        "properties": {
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          }
        }
      },
      "ToolApprovalRespondRequestV1": {
        "title": "ToolApprovalRespondRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "approval_id",
          "decision"
        ],
        "properties": {
          "approval_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "decision": {
            "$ref": "./desktop-p04-domain.schema.json#/$defs/ApprovalDecision"
          },
          "scope": {
            "enum": [
              "ONCE",
              "MISSION"
            ],
            "description": "ONCE (default) allows this exact call. MISSION also allows the same tool on the same resource with the same effects for the rest of this mission, until it expires or is revoked; the gateway still evaluates policy on every call, and tools with external, secret, desktop-input, process or database-write effects never accept it (ADR-042)."
          }
        },
        "description": "Answers a pending approval by its identifier. The payload cannot restate the tool, the arguments or the effects: the binding was fixed when the approval was requested. scope MISSION was added additively (ADR-042)."
      }
    }
  } as unknown as SchemaDocument,
  "desktop-p04-result.v1.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "DesktopPhase04ResultPayloadV1",
    "description": "The closed set of result payloads the twelve Phase-04 operations return. No result carries a credential, a raw MCP body, a filesystem path outside a declared reference, or hidden model reasoning.",
    "$comment": "نتيجة الأداة تُعرض ملخّصًا وبصمة، لا جسدًا خامًا. وما يعيده خادم MCP يبقى بيانات موسومة.",
    "anyOf": [
      {
        "$ref": "#/$defs/SkillListResultV1"
      },
      {
        "$ref": "#/$defs/SkillGetResultV1"
      },
      {
        "$ref": "#/$defs/SkillConfigureResultV1"
      },
      {
        "$ref": "#/$defs/ToolListResultV1"
      },
      {
        "$ref": "#/$defs/ToolGetResultV1"
      },
      {
        "$ref": "#/$defs/ToolActivityListResultV1"
      },
      {
        "$ref": "#/$defs/McpListResultV1"
      },
      {
        "$ref": "#/$defs/McpRegisterResultV1"
      },
      {
        "$ref": "#/$defs/McpConfigureResultV1"
      },
      {
        "$ref": "#/$defs/McpRefreshResultV1"
      },
      {
        "$ref": "#/$defs/ApprovalListResultV1"
      },
      {
        "$ref": "#/$defs/ToolApprovalRespondResultV1"
      }
    ],
    "$defs": {
      "SkillListResultV1": {
        "title": "SkillListResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "skills"
        ],
        "properties": {
          "skills": {
            "type": "array",
            "maxItems": 200,
            "items": {
              "$ref": "./desktop-p04-domain.schema.json#/$defs/SkillViewV1"
            }
          }
        }
      },
      "SkillGetResultV1": {
        "title": "SkillGetResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "skill",
          "tools"
        ],
        "properties": {
          "skill": {
            "$ref": "./desktop-p04-domain.schema.json#/$defs/SkillViewV1"
          },
          "tools": {
            "type": "array",
            "maxItems": 64,
            "items": {
              "$ref": "./desktop-p04-domain.schema.json#/$defs/ToolViewV1"
            },
            "description": "The registered descriptors of the tools this skill allows. A name in allowed_tools with no descriptor here is a tool that does not exist."
          }
        }
      },
      "SkillConfigureResultV1": {
        "title": "SkillConfigureResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "skill"
        ],
        "properties": {
          "skill": {
            "$ref": "./desktop-p04-domain.schema.json#/$defs/SkillViewV1"
          }
        }
      },
      "ToolListResultV1": {
        "title": "ToolListResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "tools"
        ],
        "properties": {
          "tools": {
            "type": "array",
            "maxItems": 500,
            "items": {
              "$ref": "./desktop-p04-domain.schema.json#/$defs/ToolViewV1"
            }
          }
        }
      },
      "ToolGetResultV1": {
        "title": "ToolGetResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "tool"
        ],
        "properties": {
          "tool": {
            "$ref": "./desktop-p04-domain.schema.json#/$defs/ToolViewV1"
          },
          "allowed_by_skills": {
            "type": "array",
            "maxItems": 200,
            "items": {
              "$ref": "./desktop-p04-domain.schema.json#/$defs/SkillId"
            }
          }
        }
      },
      "ToolActivityListResultV1": {
        "title": "ToolActivityListResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "invocations"
        ],
        "properties": {
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "invocations": {
            "type": "array",
            "maxItems": 500,
            "items": {
              "$ref": "./desktop-p04-domain.schema.json#/$defs/ToolInvocationViewV1"
            }
          },
          "summary": {
            "$ref": "./desktop-p04-domain.schema.json#/$defs/MissionToolSummaryV1"
          }
        }
      },
      "McpListResultV1": {
        "title": "McpListResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "servers"
        ],
        "properties": {
          "servers": {
            "type": "array",
            "maxItems": 100,
            "items": {
              "$ref": "./desktop-p04-domain.schema.json#/$defs/McpServerViewV1"
            }
          }
        }
      },
      "McpRegisterResultV1": {
        "title": "McpRegisterResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "server"
        ],
        "properties": {
          "server": {
            "$ref": "./desktop-p04-domain.schema.json#/$defs/McpServerViewV1"
          }
        }
      },
      "McpConfigureResultV1": {
        "title": "McpConfigureResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "server"
        ],
        "properties": {
          "server": {
            "$ref": "./desktop-p04-domain.schema.json#/$defs/McpServerViewV1"
          }
        }
      },
      "McpRefreshResultV1": {
        "title": "McpRefreshResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "server",
          "accepted",
          "rejected"
        ],
        "properties": {
          "server": {
            "$ref": "./desktop-p04-domain.schema.json#/$defs/McpServerViewV1"
          },
          "accepted": {
            "type": "array",
            "maxItems": 200,
            "items": {
              "$ref": "./desktop-p04-domain.schema.json#/$defs/ToolViewV1"
            }
          },
          "pending_redefinitions": {
            "type": "array",
            "maxItems": 200,
            "description": "Tools whose definition changed after discovery and that stay disabled until the user accepts the new definition (remediation 2026-10-12).",
            "items": {
              "$ref": "./desktop-p04-domain.schema.json#/$defs/ToolId"
            }
          },
          "rejected": {
            "type": "array",
            "maxItems": 200,
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "declared_name",
                "reason"
              ],
              "properties": {
                "declared_name": {
                  "$ref": "./desktop-p04-domain.schema.json#/$defs/BoundedLabel"
                },
                "reason": {
                  "$ref": "./desktop-p04-domain.schema.json#/$defs/ToolDenialReason"
                },
                "detail": {
                  "$ref": "./desktop-p04-domain.schema.json#/$defs/BoundedDescription"
                }
              }
            },
            "description": "Every tool the server offered and the registry refused, with the reason. A rejected tool is reported, never silently dropped."
          }
        }
      },
      "ApprovalListResultV1": {
        "title": "ApprovalListResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "approvals"
        ],
        "properties": {
          "approvals": {
            "type": "array",
            "maxItems": 200,
            "items": {
              "$ref": "./desktop-p04-domain.schema.json#/$defs/ApprovalViewV1"
            }
          }
        }
      },
      "ToolApprovalRespondResultV1": {
        "title": "ToolApprovalRespondResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "approval"
        ],
        "properties": {
          "approval": {
            "$ref": "./desktop-p04-domain.schema.json#/$defs/ApprovalViewV1"
          }
        }
      }
    }
  } as unknown as SchemaDocument,
  "desktop-p05-domain.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "DesktopPhase05Domain",
    "description": "The closed vocabularies and shared shapes of Phase-05: memory entries with provenance, browser sessions and their actions, computer sessions, window grants and screen observations. Memory is never truth, web content is WEB_UNTRUSTED, and screen content is UNTRUSTED_CONTENT.",
    "$comment": "مفردات مغلقة. الذاكرة ليست مرساة ثقة، ولا حالة VERIFIED لها. محتوى الويب والشاشة بيانات، ولا حقل هنا يحمل بكسلات أو جسم صفحة أو تفكيرًا مخفيًا.",
    "$defs": {
      "MemoryType": {
        "title": "MemoryType",
        "type": "string",
        "enum": [
          "WORKING",
          "EPISODIC",
          "SEMANTIC",
          "PREFERENCE",
          "PROJECT"
        ],
        "description": "The kind of memory."
      },
      "MemoryScope": {
        "title": "MemoryScope",
        "type": "string",
        "enum": [
          "MISSION",
          "PROJECT",
          "USER",
          "SYSTEM"
        ],
        "description": "Where a memory is visible. A mission memory reaches no other mission unless explicitly promoted to a wider scope."
      },
      "MemoryStatus": {
        "title": "MemoryStatus",
        "type": "string",
        "enum": [
          "ACTIVE",
          "SUPERSEDED",
          "EXPIRED",
          "DELETED"
        ],
        "description": "Lifecycle of a memory entry. A DELETED entry carries no subject, summary or content."
      },
      "MemoryTrustClass": {
        "title": "MemoryTrustClass",
        "type": "string",
        "enum": [
          "SYSTEM_GENERATED",
          "MODEL_GENERATED",
          "USER_DERIVED"
        ],
        "description": "Who wrote the content. Approval of a write does not change who wrote it."
      },
      "MemoryVerification": {
        "title": "MemoryVerification",
        "type": "string",
        "enum": [
          "UNVERIFIED",
          "EVIDENCE_LINKED",
          "CONFLICTED"
        ],
        "description": "Whether the entry was linked to measured evidence when it was written. There is no VERIFIED state: memory is never truth, and retrieval never re-verifies."
      },
      "ConfidenceSource": {
        "title": "ConfidenceSource",
        "type": "string",
        "enum": [
          "RUNTIME_EVIDENCE",
          "RUNTIME_OBSERVATION",
          "MODEL_SELF_REPORT",
          "USER_APPROVED_WRITE",
          "NONE"
        ],
        "description": "Where the stated confidence came from. A model reporting its own confidence never raises trust."
      },
      "ConflictState": {
        "title": "ConflictState",
        "type": "string",
        "enum": [
          "NO_CONFLICT",
          "CONFLICT",
          "SUPERSEDED_BY_VERIFIED_SOURCE",
          "INSUFFICIENT_EVIDENCE",
          "SUPERSEDED_BY_USER"
        ],
        "description": "How two entries about one subject relate. The newer entry is never chosen as truth automatically."
      },
      "SourceKind": {
        "title": "SourceKind",
        "type": "string",
        "enum": [
          "MISSION",
          "TASK",
          "CLAIM",
          "EVIDENCE",
          "TOOL_INVOCATION",
          "AGENT",
          "USER"
        ],
        "description": "The kind of a memory source reference."
      },
      "TaintFlag": {
        "title": "TaintFlag",
        "type": "string",
        "enum": [
          "UNTRUSTED_CONTENT",
          "MODEL_GENERATED",
          "AGENT_RELAYED",
          "UNVERIFIED_CLAIM"
        ],
        "description": "Taint carried by a memory entry. Union only; nothing removes a flag."
      },
      "SessionState": {
        "title": "SessionState",
        "type": "string",
        "enum": [
          "CREATED",
          "ACTIVE",
          "WAITING",
          "CLOSED",
          "FAILED",
          "CANCELLED"
        ],
        "description": "State of a browser or computer session. A terminal session is never reused."
      },
      "BrowserAction": {
        "title": "BrowserAction",
        "type": "string",
        "enum": [
          "NAVIGATE",
          "READ",
          "CLICK",
          "TYPE",
          "BACK",
          "FORWARD",
          "RELOAD",
          "DOWNLOAD",
          "UPLOAD"
        ],
        "description": "A browser action recorded in a session history."
      },
      "ComputerAction": {
        "title": "ComputerAction",
        "type": "string",
        "enum": [
          "WINDOW_LIST",
          "OBSERVE",
          "FOCUS",
          "POINTER_MOVE",
          "CLICK",
          "KEY",
          "TYPE",
          "SCROLL"
        ],
        "description": "A computer action recorded in a session history."
      },
      "ActionStatus": {
        "title": "ActionStatus",
        "type": "string",
        "enum": [
          "EXECUTED",
          "DENIED",
          "FAILED",
          "CANCELLED"
        ],
        "description": "Whether the action happened. A denial is recorded like an execution, with its reason."
      },
      "ActionOutcome": {
        "title": "ActionOutcome",
        "type": "string",
        "enum": [
          "ACTION_EXECUTED",
          "NOT_EXECUTED"
        ],
        "description": "The action-level outcome. Execution is not verification: whether the outcome was achieved is decided by the truth layer against observed evidence, never here."
      },
      "ReasonCode": {
        "title": "ReasonCode",
        "type": "string",
        "pattern": "^[A-Za-z0-9_:.-]{1,80}$",
        "description": "A closed-vocabulary reason code, never free prose."
      },
      "WindowHandle": {
        "title": "WindowHandle",
        "type": "string",
        "pattern": "^0x[0-9a-f]{1,16}$",
        "description": "A window handle as a lowercase 0x-prefixed hexadecimal literal. A handle alone is not an identity; a grant binds the handle, the process id, the process creation time and the executable."
      },
      "BoundedUrl": {
        "title": "BoundedUrl",
        "type": "string",
        "maxLength": 2048,
        "description": "A web address as observed. Data, not a destination the renderer may request."
      },
      "MemoryViewV1": {
        "title": "MemoryViewV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "memory_id",
          "memory_type",
          "scope",
          "subject",
          "summary",
          "trust_class",
          "verification",
          "taint",
          "confidence_source",
          "importance",
          "status",
          "version",
          "source",
          "source_ref_count",
          "created_at",
          "updated_at"
        ],
        "properties": {
          "memory_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "memory_type": {
            "$ref": "#/$defs/MemoryType"
          },
          "scope": {
            "$ref": "#/$defs/MemoryScope"
          },
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "project_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "subject": {
            "type": "string",
            "maxLength": 120
          },
          "summary": {
            "type": "string",
            "maxLength": 240
          },
          "trust_class": {
            "$ref": "#/$defs/MemoryTrustClass"
          },
          "verification": {
            "$ref": "#/$defs/MemoryVerification"
          },
          "taint": {
            "type": "array",
            "maxItems": 4,
            "uniqueItems": true,
            "items": {
              "$ref": "#/$defs/TaintFlag"
            }
          },
          "confidence_source": {
            "$ref": "#/$defs/ConfidenceSource"
          },
          "importance": {
            "type": "integer",
            "minimum": 1,
            "maximum": 5
          },
          "status": {
            "$ref": "#/$defs/MemoryStatus"
          },
          "version": {
            "type": "integer",
            "minimum": 1
          },
          "source": {
            "$ref": "./desktop-p04-domain.schema.json#/$defs/BoundedLabel"
          },
          "source_ref_count": {
            "type": "integer",
            "minimum": 0
          },
          "created_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          },
          "updated_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          },
          "last_accessed_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          }
        },
        "description": "A memory entry as listed: its type, scope, subject, bounded summary, origin, verification link, taint and provenance counts. Never hidden reasoning."
      },
      "SourceRefViewV1": {
        "title": "SourceRefViewV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "kind",
          "reference"
        ],
        "properties": {
          "kind": {
            "$ref": "#/$defs/SourceKind"
          },
          "reference": {
            "$ref": "./desktop-p04-domain.schema.json#/$defs/BoundedLabel"
          }
        },
        "description": "One source reference: its kind and identifier, never the source text."
      },
      "MemoryDetailViewV1": {
        "title": "MemoryDetailViewV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "memory_id",
          "memory_type",
          "scope",
          "subject",
          "summary",
          "trust_class",
          "verification",
          "taint",
          "confidence_source",
          "importance",
          "status",
          "version",
          "source",
          "source_ref_count",
          "created_at",
          "updated_at",
          "content",
          "label",
          "source_refs",
          "lineage"
        ],
        "properties": {
          "memory_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "memory_type": {
            "$ref": "#/$defs/MemoryType"
          },
          "scope": {
            "$ref": "#/$defs/MemoryScope"
          },
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "project_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "subject": {
            "type": "string",
            "maxLength": 120
          },
          "summary": {
            "type": "string",
            "maxLength": 240
          },
          "trust_class": {
            "$ref": "#/$defs/MemoryTrustClass"
          },
          "verification": {
            "$ref": "#/$defs/MemoryVerification"
          },
          "taint": {
            "type": "array",
            "maxItems": 4,
            "uniqueItems": true,
            "items": {
              "$ref": "#/$defs/TaintFlag"
            }
          },
          "confidence_source": {
            "$ref": "#/$defs/ConfidenceSource"
          },
          "importance": {
            "type": "integer",
            "minimum": 1,
            "maximum": 5
          },
          "status": {
            "$ref": "#/$defs/MemoryStatus"
          },
          "version": {
            "type": "integer",
            "minimum": 1
          },
          "source": {
            "$ref": "./desktop-p04-domain.schema.json#/$defs/BoundedLabel"
          },
          "source_ref_count": {
            "type": "integer",
            "minimum": 0
          },
          "created_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          },
          "updated_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          },
          "last_accessed_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          },
          "content": {
            "type": "string",
            "maxLength": 2000
          },
          "label": {
            "const": "MEMORY — UNTRUSTED / NON-AUTHORITATIVE"
          },
          "source_refs": {
            "type": "array",
            "maxItems": 24,
            "items": {
              "$ref": "#/$defs/SourceRefViewV1"
            }
          },
          "lineage": {
            "type": "array",
            "maxItems": 24,
            "items": {
              "$ref": "./desktop-p04-domain.schema.json#/$defs/BoundedLabel"
            }
          }
        },
        "description": "One memory entry with its content, its constant untrusted label and its source lineage. The user owns this content and may delete it."
      },
      "MemoryConflictViewV1": {
        "title": "MemoryConflictViewV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "conflict_id",
          "memory_a",
          "memory_b",
          "subject",
          "state",
          "detected_at"
        ],
        "properties": {
          "conflict_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "memory_a": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "memory_b": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "subject": {
            "type": "string",
            "maxLength": 120
          },
          "state": {
            "$ref": "#/$defs/ConflictState"
          },
          "detected_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          }
        },
        "description": "A recorded conflict between two entries. It is shown, never resolved by recency."
      },
      "BrowserSessionViewV1": {
        "title": "BrowserSessionViewV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "session_id",
          "mission_id",
          "owner_agent_id",
          "state",
          "navigation_count",
          "action_count",
          "download_count",
          "upload_count",
          "trust",
          "created_at",
          "last_activity_at"
        ],
        "properties": {
          "session_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "owner_agent_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "state": {
            "$ref": "#/$defs/SessionState"
          },
          "current_origin": {
            "type": "string",
            "maxLength": 300
          },
          "current_url": {
            "type": "string",
            "maxLength": 600
          },
          "current_title": {
            "type": "string",
            "maxLength": 300
          },
          "navigation_count": {
            "type": "integer",
            "minimum": 0
          },
          "action_count": {
            "type": "integer",
            "minimum": 0
          },
          "download_count": {
            "type": "integer",
            "minimum": 0
          },
          "upload_count": {
            "type": "integer",
            "minimum": 0
          },
          "trust": {
            "const": "WEB_UNTRUSTED"
          },
          "created_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          },
          "last_activity_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          },
          "closed_reason": {
            "$ref": "#/$defs/ReasonCode"
          }
        },
        "description": "A mission-bound browser session. Its page content is WEB_UNTRUSTED; only addresses, titles and counts cross here."
      },
      "BrowserActionViewV1": {
        "title": "BrowserActionViewV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "action_id",
          "task_id",
          "action",
          "target",
          "status",
          "outcome",
          "occurred_at",
          "duration_ms"
        ],
        "properties": {
          "action_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "task_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "action": {
            "$ref": "#/$defs/BrowserAction"
          },
          "target": {
            "type": "string",
            "maxLength": 300
          },
          "status": {
            "$ref": "#/$defs/ActionStatus"
          },
          "reason_code": {
            "$ref": "#/$defs/ReasonCode"
          },
          "url": {
            "type": "string",
            "maxLength": 600
          },
          "http_status": {
            "type": "integer",
            "minimum": 100,
            "maximum": 599
          },
          "content_digest": {
            "$ref": "./common/ids.schema.json#/$defs/Sha256Hex"
          },
          "outcome": {
            "$ref": "#/$defs/ActionOutcome"
          },
          "occurred_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          },
          "duration_ms": {
            "type": "integer",
            "minimum": 0
          }
        },
        "description": "One browser action, executed or refused, with its reason and digest."
      },
      "DownloadViewV1": {
        "title": "DownloadViewV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "download_id",
          "file_name",
          "byte_count",
          "sha256",
          "content_type",
          "executable",
          "trust",
          "downloaded_at"
        ],
        "properties": {
          "download_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "file_name": {
            "type": "string",
            "maxLength": 200
          },
          "byte_count": {
            "type": "integer",
            "minimum": 0
          },
          "sha256": {
            "$ref": "./common/ids.schema.json#/$defs/Sha256Hex"
          },
          "content_type": {
            "type": "string",
            "maxLength": 200
          },
          "executable": {
            "type": "boolean"
          },
          "trust": {
            "const": "UNTRUSTED_CONTENT"
          },
          "downloaded_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          }
        },
        "description": "A quarantined download. It is never opened or run, and carries no path."
      },
      "TargetViewV1": {
        "title": "TargetViewV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "grant_id",
          "mission_id",
          "title",
          "executable",
          "pid",
          "hwnd",
          "process_created_at",
          "granted_at"
        ],
        "properties": {
          "grant_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "title": {
            "type": "string",
            "maxLength": 200
          },
          "executable": {
            "type": "string",
            "maxLength": 260
          },
          "pid": {
            "type": "integer",
            "minimum": 0
          },
          "hwnd": {
            "$ref": "#/$defs/WindowHandle"
          },
          "process_created_at": {
            "type": "string",
            "pattern": "^[0-9]{1,20}$"
          },
          "granted_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          },
          "revoked_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          }
        },
        "description": "A window granted to one mission, bound to its full identity: handle, process id, process creation time and executable."
      },
      "ObservationViewV1": {
        "title": "ObservationViewV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "observation_id",
          "observed_at",
          "width",
          "height",
          "frame_digest",
          "layout_digest",
          "element_count",
          "capture_scope",
          "trust"
        ],
        "properties": {
          "observation_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "observed_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          },
          "width": {
            "type": "integer",
            "minimum": 0
          },
          "height": {
            "type": "integer",
            "minimum": 0
          },
          "frame_digest": {
            "$ref": "./common/ids.schema.json#/$defs/Sha256Hex"
          },
          "layout_digest": {
            "$ref": "./common/ids.schema.json#/$defs/Sha256Hex"
          },
          "element_count": {
            "type": "integer",
            "minimum": 0
          },
          "capture_scope": {
            "const": "WINDOW"
          },
          "trust": {
            "const": "UNTRUSTED_CONTENT"
          }
        },
        "description": "A screen observation by its digests and dimensions. No pixels and no element text cross here."
      },
      "ComputerActionViewV1": {
        "title": "ComputerActionViewV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "action_id",
          "task_id",
          "action",
          "target",
          "status",
          "occurred_at",
          "duration_ms"
        ],
        "properties": {
          "action_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "task_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "action": {
            "$ref": "#/$defs/ComputerAction"
          },
          "target": {
            "type": "string",
            "maxLength": 300
          },
          "status": {
            "$ref": "#/$defs/ActionStatus"
          },
          "reason_code": {
            "$ref": "#/$defs/ReasonCode"
          },
          "observation_digest": {
            "type": "string",
            "maxLength": 64
          },
          "occurred_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          },
          "duration_ms": {
            "type": "integer",
            "minimum": 0
          }
        },
        "description": "One computer action, executed or refused, bound to the observation digest it was proposed against."
      },
      "ComputerSessionViewV1": {
        "title": "ComputerSessionViewV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "session_id",
          "mission_id",
          "agent_id",
          "state",
          "created_at",
          "action_count",
          "click_count",
          "keyboard_count",
          "capture_count"
        ],
        "properties": {
          "session_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "agent_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "state": {
            "$ref": "#/$defs/SessionState"
          },
          "target": {
            "$ref": "#/$defs/TargetViewV1"
          },
          "created_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          },
          "last_action_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          },
          "action_count": {
            "type": "integer",
            "minimum": 0
          },
          "click_count": {
            "type": "integer",
            "minimum": 0
          },
          "keyboard_count": {
            "type": "integer",
            "minimum": 0
          },
          "capture_count": {
            "type": "integer",
            "minimum": 0
          },
          "closed_reason": {
            "$ref": "#/$defs/ReasonCode"
          },
          "last_observation": {
            "$ref": "#/$defs/ObservationViewV1"
          },
          "last_action": {
            "$ref": "#/$defs/ComputerActionViewV1"
          }
        },
        "description": "A mission-bound computer session with its target window, counters, last observation and last action."
      },
      "DesktopWindowViewV1": {
        "title": "DesktopWindowViewV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "hwnd",
          "title",
          "executable",
          "pid",
          "grantable"
        ],
        "properties": {
          "hwnd": {
            "$ref": "#/$defs/WindowHandle"
          },
          "title": {
            "type": "string",
            "maxLength": 200
          },
          "executable": {
            "type": "string",
            "maxLength": 260
          },
          "pid": {
            "type": "integer",
            "minimum": 0
          },
          "grantable": {
            "type": "boolean"
          },
          "reason": {
            "$ref": "#/$defs/ReasonCode"
          }
        },
        "description": "A window shown to the user so they can grant it to a mission. This inventory never reaches a model."
      }
    }
  } as unknown as SchemaDocument,
  "desktop-p05-request.v1.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "DesktopPhase05RequestPayloadV1",
    "description": "The closed set of request payloads the twelve Phase-05 operations accept. No payload can name a web destination, send input, carry a free file path, or raise the trust of a memory.",
    "$comment": "لا فعل متصفّح ولا فعل حاسوب من العارض، ولا ترقية ذاكرة. الأفعال تبدأ من زمن تشغيل المهمّة عبر بوابة الأدوات وحدها.",
    "anyOf": [
      {
        "$ref": "#/$defs/MemoryListRequestV1"
      },
      {
        "$ref": "#/$defs/MemoryGetRequestV1"
      },
      {
        "$ref": "#/$defs/MemoryDeleteRequestV1"
      },
      {
        "$ref": "#/$defs/BrowserSessionListRequestV1"
      },
      {
        "$ref": "#/$defs/BrowserSessionGetRequestV1"
      },
      {
        "$ref": "#/$defs/BrowserSessionCancelRequestV1"
      },
      {
        "$ref": "#/$defs/ComputerSessionListRequestV1"
      },
      {
        "$ref": "#/$defs/ComputerSessionGetRequestV1"
      },
      {
        "$ref": "#/$defs/ComputerSessionCancelRequestV1"
      },
      {
        "$ref": "#/$defs/ComputerWindowListRequestV1"
      },
      {
        "$ref": "#/$defs/ComputerTargetGrantRequestV1"
      },
      {
        "$ref": "#/$defs/ComputerTargetRevokeRequestV1"
      }
    ],
    "$defs": {
      "MemoryListRequestV1": {
        "title": "MemoryListRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [],
        "properties": {
          "scope": {
            "$ref": "./desktop-p05-domain.schema.json#/$defs/MemoryScope"
          },
          "memory_type": {
            "$ref": "./desktop-p05-domain.schema.json#/$defs/MemoryType"
          },
          "status": {
            "$ref": "./desktop-p05-domain.schema.json#/$defs/MemoryStatus"
          },
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "project_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "text": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200
          },
          "limit": {
            "type": "integer",
            "minimum": 1,
            "maximum": 500
          }
        },
        "description": "Lists memory entries by scope, type, status, owner or text. Deleted entries are not listed unless DELETED is asked for. No side effect."
      },
      "MemoryGetRequestV1": {
        "title": "MemoryGetRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "memory_id"
        ],
        "properties": {
          "memory_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          }
        },
        "description": "Reads one entry with its content, lineage and conflicts. Records a USER_VIEW access."
      },
      "MemoryDeleteRequestV1": {
        "title": "MemoryDeleteRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "memory_id"
        ],
        "properties": {
          "memory_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          }
        },
        "description": "Deletes an entry from the store: its content, subject and sources are erased, not hidden."
      },
      "BrowserSessionListRequestV1": {
        "title": "BrowserSessionListRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [],
        "properties": {
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          }
        },
        "description": "Lists browser sessions, optionally for one mission. No side effect."
      },
      "BrowserSessionGetRequestV1": {
        "title": "BrowserSessionGetRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "session_id"
        ],
        "properties": {
          "session_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          }
        },
        "description": "Reads one browser session with its action history and downloads. No side effect."
      },
      "BrowserSessionCancelRequestV1": {
        "title": "BrowserSessionCancelRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "session_id"
        ],
        "properties": {
          "session_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          }
        },
        "description": "Stops a browser session. No further browser action runs in it."
      },
      "ComputerSessionListRequestV1": {
        "title": "ComputerSessionListRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [],
        "properties": {
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          }
        },
        "description": "Lists computer sessions, optionally for one mission. No side effect."
      },
      "ComputerSessionGetRequestV1": {
        "title": "ComputerSessionGetRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "session_id"
        ],
        "properties": {
          "session_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          }
        },
        "description": "Reads one computer session with its actions and observation digests. No side effect."
      },
      "ComputerSessionCancelRequestV1": {
        "title": "ComputerSessionCancelRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "session_id"
        ],
        "properties": {
          "session_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          }
        },
        "description": "Stops a computer session. No further input is sent in it."
      },
      "ComputerWindowListRequestV1": {
        "title": "ComputerWindowListRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [],
        "properties": {
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          }
        },
        "description": "Lists the visible windows so the user can grant one, and the grants of one mission. The inventory never reaches a model. No side effect."
      },
      "ComputerTargetGrantRequestV1": {
        "title": "ComputerTargetGrantRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "mission_id",
          "hwnd"
        ],
        "properties": {
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "hwnd": {
            "$ref": "./desktop-p05-domain.schema.json#/$defs/WindowHandle"
          }
        },
        "description": "Grants one window to one mission. The host reads the window identity from the system, never from this payload."
      },
      "ComputerTargetRevokeRequestV1": {
        "title": "ComputerTargetRevokeRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "grant_id"
        ],
        "properties": {
          "grant_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          }
        },
        "description": "Revokes a window grant. Actions bound to it are refused afterwards."
      }
    }
  } as unknown as SchemaDocument,
  "desktop-p05-result.v1.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "DesktopPhase05ResultPayloadV1",
    "description": "The closed set of result payloads the twelve Phase-05 operations return. No result carries a page body, pixels, a free file path, a credential, or hidden model reasoning.",
    "$comment": "ما يعبر: معرّفات وحالات وأصناف وبصمات ونصوص محدودة. المحتوى الخام يبقى في المضيف.",
    "anyOf": [
      {
        "$ref": "#/$defs/MemoryListResultV1"
      },
      {
        "$ref": "#/$defs/MemoryGetResultV1"
      },
      {
        "$ref": "#/$defs/MemoryDeleteResultV1"
      },
      {
        "$ref": "#/$defs/BrowserSessionListResultV1"
      },
      {
        "$ref": "#/$defs/BrowserSessionGetResultV1"
      },
      {
        "$ref": "#/$defs/SessionCancelResultV1"
      },
      {
        "$ref": "#/$defs/ComputerSessionListResultV1"
      },
      {
        "$ref": "#/$defs/ComputerSessionGetResultV1"
      },
      {
        "$ref": "#/$defs/ComputerWindowListResultV1"
      },
      {
        "$ref": "#/$defs/ComputerTargetGrantResultV1"
      },
      {
        "$ref": "#/$defs/ComputerTargetRevokeResultV1"
      }
    ],
    "$defs": {
      "MemoryListResultV1": {
        "title": "MemoryListResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "memories",
          "label"
        ],
        "properties": {
          "memories": {
            "type": "array",
            "maxItems": 500,
            "items": {
              "$ref": "./desktop-p05-domain.schema.json#/$defs/MemoryViewV1"
            }
          },
          "label": {
            "const": "MEMORY — UNTRUSTED / NON-AUTHORITATIVE"
          }
        },
        "description": "Memory entries and the constant label that says none of them is truth."
      },
      "MemoryGetResultV1": {
        "title": "MemoryGetResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "memory",
          "conflicts"
        ],
        "properties": {
          "memory": {
            "$ref": "./desktop-p05-domain.schema.json#/$defs/MemoryDetailViewV1"
          },
          "conflicts": {
            "type": "array",
            "maxItems": 100,
            "items": {
              "$ref": "./desktop-p05-domain.schema.json#/$defs/MemoryConflictViewV1"
            }
          }
        },
        "description": "One memory entry and every conflict it takes part in."
      },
      "MemoryDeleteResultV1": {
        "title": "MemoryDeleteResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "memory_id",
          "deleted",
          "status"
        ],
        "properties": {
          "memory_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "deleted": {
            "type": "boolean"
          },
          "status": {
            "const": "DELETED"
          }
        },
        "description": "Whether this call deleted the entry. A second delete reports false."
      },
      "BrowserSessionListResultV1": {
        "title": "BrowserSessionListResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "sessions"
        ],
        "properties": {
          "sessions": {
            "type": "array",
            "maxItems": 200,
            "items": {
              "$ref": "./desktop-p05-domain.schema.json#/$defs/BrowserSessionViewV1"
            }
          }
        },
        "description": "Browser sessions."
      },
      "BrowserSessionGetResultV1": {
        "title": "BrowserSessionGetResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "session",
          "actions",
          "downloads"
        ],
        "properties": {
          "session": {
            "$ref": "./desktop-p05-domain.schema.json#/$defs/BrowserSessionViewV1"
          },
          "actions": {
            "type": "array",
            "maxItems": 500,
            "items": {
              "$ref": "./desktop-p05-domain.schema.json#/$defs/BrowserActionViewV1"
            }
          },
          "downloads": {
            "type": "array",
            "maxItems": 50,
            "items": {
              "$ref": "./desktop-p05-domain.schema.json#/$defs/DownloadViewV1"
            }
          }
        },
        "description": "One browser session with its history."
      },
      "SessionCancelResultV1": {
        "title": "SessionCancelResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "session_id",
          "state"
        ],
        "properties": {
          "session_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "state": {
            "$ref": "./desktop-p05-domain.schema.json#/$defs/SessionState"
          }
        },
        "description": "The session state after the stop."
      },
      "ComputerSessionListResultV1": {
        "title": "ComputerSessionListResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "sessions"
        ],
        "properties": {
          "sessions": {
            "type": "array",
            "maxItems": 200,
            "items": {
              "$ref": "./desktop-p05-domain.schema.json#/$defs/ComputerSessionViewV1"
            }
          }
        },
        "description": "Computer sessions."
      },
      "ComputerSessionGetResultV1": {
        "title": "ComputerSessionGetResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "session",
          "actions",
          "observations"
        ],
        "properties": {
          "session": {
            "$ref": "./desktop-p05-domain.schema.json#/$defs/ComputerSessionViewV1"
          },
          "actions": {
            "type": "array",
            "maxItems": 500,
            "items": {
              "$ref": "./desktop-p05-domain.schema.json#/$defs/ComputerActionViewV1"
            }
          },
          "observations": {
            "type": "array",
            "maxItems": 20,
            "items": {
              "$ref": "./desktop-p05-domain.schema.json#/$defs/ObservationViewV1"
            }
          }
        },
        "description": "One computer session with its actions and bounded observation digests."
      },
      "ComputerWindowListResultV1": {
        "title": "ComputerWindowListResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "available",
          "windows",
          "grants"
        ],
        "properties": {
          "available": {
            "type": "boolean"
          },
          "windows": {
            "type": "array",
            "maxItems": 100,
            "items": {
              "$ref": "./desktop-p05-domain.schema.json#/$defs/DesktopWindowViewV1"
            }
          },
          "grants": {
            "type": "array",
            "maxItems": 50,
            "items": {
              "$ref": "./desktop-p05-domain.schema.json#/$defs/TargetViewV1"
            }
          }
        },
        "description": "Whether desktop control exists on this host, the visible windows, and one mission grants."
      },
      "ComputerTargetGrantResultV1": {
        "title": "ComputerTargetGrantResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "grant"
        ],
        "properties": {
          "grant": {
            "$ref": "./desktop-p05-domain.schema.json#/$defs/TargetViewV1"
          }
        },
        "description": "The grant, with the identity the host read."
      },
      "ComputerTargetRevokeResultV1": {
        "title": "ComputerTargetRevokeResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "grant_id",
          "revoked"
        ],
        "properties": {
          "grant_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "revoked": {
            "type": "boolean"
          }
        },
        "description": "Whether this call revoked the grant."
      }
    }
  } as unknown as SchemaDocument,
  "desktop-p06-domain.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "DesktopPhase06DomainV1",
    "description": "Phase-06 domain vocabulary: connectors, usage and cost with provenance, budgets, structured observability, health, and the typed configuration control plane. No definition here carries a credential value; a secret crosses the boundary only as a configured flag, a source and a reference.",
    "$comment": "المفردات مغلقة. لا قيمة سرّ، ولا جسم استجابة خام، ولا عنوان يختاره وكيل.",
    "$defs": {
      "ConnectorId": {
        "$ref": "./common/ids.schema.json#/$defs/Uuid",
        "description": "A connector identifier issued by the host at registration."
      },
      "OperationId": {
        "title": "OperationId",
        "type": "string",
        "pattern": "^[a-z][a-z0-9_.-]{0,63}$",
        "description": "A registered connector operation. An agent chooses one of these; it never names a URL."
      },
      "ConnectorCategory": {
        "title": "ConnectorCategory",
        "type": "string",
        "enum": [
          "EMAIL",
          "CALENDAR",
          "FILES",
          "MESSAGING",
          "PROJECT_MANAGEMENT",
          "CODE_HOSTING",
          "DATABASE",
          "CUSTOM_API"
        ]
      },
      "ConnectorProvider": {
        "title": "ConnectorProvider",
        "type": "string",
        "enum": [
          "polaris.rest",
          "polaris.workspace"
        ],
        "description": "The adapter family. polaris.rest is the generic REST connector; polaris.workspace reads the sources of one project."
      },
      "AuthMode": {
        "title": "AuthMode",
        "type": "string",
        "enum": [
          "NONE",
          "API_KEY",
          "BEARER_TOKEN",
          "BASIC",
          "OAUTH2"
        ],
        "description": "OAUTH2 is part of the vocabulary and refused at registration in this build: no official flow is implemented."
      },
      "KeySource": {
        "title": "KeySource",
        "type": "string",
        "enum": [
          "NONE",
          "CREDENTIAL_STORE",
          "ENVIRONMENT"
        ],
        "description": "Where the host resolves the connector key at call time. The value never crosses the boundary."
      },
      "OperationAction": {
        "title": "OperationAction",
        "type": "string",
        "enum": [
          "READ",
          "WRITE",
          "DELETE",
          "SEND",
          "PUBLISH",
          "CREATE_EXTERNAL_RESOURCE",
          "MODIFY_EXTERNAL_RESOURCE"
        ],
        "description": "Every action other than READ is an EXTERNAL_SIDE_EFFECT that waits for a bound approval."
      },
      "EgressClass": {
        "title": "EgressClass",
        "type": "string",
        "enum": [
          "PUBLIC_HTTPS",
          "LOOPBACK",
          "NONE"
        ],
        "description": "PUBLIC_HTTPS reaches public addresses resolved and checked at connect time; LOOPBACK is the literal loopback interface only; NONE is a local connector with no network."
      },
      "HttpMethod": {
        "title": "HttpMethod",
        "type": "string",
        "enum": [
          "GET",
          "POST",
          "PUT",
          "PATCH",
          "DELETE"
        ]
      },
      "ParamLocation": {
        "title": "ParamLocation",
        "type": "string",
        "enum": [
          "PATH",
          "QUERY",
          "BODY"
        ]
      },
      "ParamKind": {
        "title": "ParamKind",
        "type": "string",
        "enum": [
          "STRING",
          "INTEGER",
          "BOOLEAN",
          "ENUM"
        ]
      },
      "ConnectorStatus": {
        "title": "ConnectorStatus",
        "type": "string",
        "enum": [
          "REGISTERED",
          "ENABLED",
          "DISABLED"
        ]
      },
      "ProvenanceOrigin": {
        "title": "ProvenanceOrigin",
        "type": "string",
        "enum": [
          "USER_REGISTERED",
          "OPENAPI_IMPORT",
          "BUILT_IN_PRESET"
        ]
      },
      "InvocationOutcome": {
        "title": "InvocationOutcome",
        "type": "string",
        "enum": [
          "SUCCEEDED",
          "FAILED",
          "DENIED",
          "CANCELLED",
          "REPLAYED",
          "OUTCOME_UNKNOWN"
        ]
      },
      "HealthState": {
        "title": "HealthState",
        "type": "string",
        "enum": [
          "UNKNOWN",
          "HEALTHY",
          "DEGRADED",
          "UNHEALTHY",
          "UNAVAILABLE"
        ],
        "description": "UNKNOWN until measured in this session; a measurement from a previous start is never shown as present health."
      },
      "HealthSubject": {
        "title": "HealthSubject",
        "type": "string",
        "enum": [
          "PROVIDER",
          "CONNECTOR",
          "STORAGE",
          "BROWSER",
          "COMPUTER",
          "MEMORY",
          "TOOL_GATEWAY",
          "AGENT_RUNTIME",
          "CONFIG"
        ]
      },
      "CostProvenance": {
        "title": "CostProvenance",
        "type": "string",
        "enum": [
          "PROVIDER_REPORTED",
          "LOCALLY_MEASURED",
          "ESTIMATED",
          "UNKNOWN"
        ],
        "description": "ESTIMATED comes from a price the user entered with its source and is never an invoice; UNKNOWN carries no amount."
      },
      "UsageCategory": {
        "title": "UsageCategory",
        "type": "string",
        "enum": [
          "MODEL",
          "TOOL",
          "BROWSER",
          "COMPUTER",
          "CONNECTOR"
        ]
      },
      "BudgetScope": {
        "title": "BudgetScope",
        "type": "string",
        "enum": [
          "MISSION",
          "PROJECT",
          "DAY",
          "PROVIDER",
          "CONNECTOR"
        ]
      },
      "BudgetDimension": {
        "title": "BudgetDimension",
        "type": "string",
        "enum": [
          "COST_MICROS",
          "MODEL_TOKENS",
          "EXTERNAL_CALLS"
        ]
      },
      "BudgetMode": {
        "title": "BudgetMode",
        "type": "string",
        "enum": [
          "SOFT",
          "HARD"
        ],
        "description": "HARD blocks the next call before any effect; SOFT warns and permits."
      },
      "BudgetState": {
        "title": "BudgetState",
        "type": "string",
        "enum": [
          "WITHIN",
          "NEAR_LIMIT",
          "AT_LIMIT",
          "EXCEEDED"
        ]
      },
      "PricingTarget": {
        "title": "PricingTarget",
        "type": "string",
        "enum": [
          "MODEL",
          "CONNECTOR"
        ]
      },
      "PricingUnit": {
        "title": "PricingUnit",
        "type": "string",
        "enum": [
          "PER_MILLION_INPUT_TOKENS",
          "PER_MILLION_OUTPUT_TOKENS",
          "PER_CALL"
        ]
      },
      "Currency": {
        "title": "Currency",
        "type": "string",
        "pattern": "^[A-Z]{3}$",
        "description": "An ISO 4217 code. No amount is ever converted between currencies."
      },
      "DecimalText": {
        "title": "DecimalText",
        "type": "string",
        "pattern": "^[0-9]{1,12}(\\.[0-9]{1,6})?$",
        "description": "An exact non-negative decimal. Money never travels as a binary float."
      },
      "AlertKind": {
        "title": "AlertKind",
        "type": "string",
        "enum": [
          "BUDGET_NEAR_LIMIT",
          "BUDGET_EXCEEDED",
          "PROVIDER_UNHEALTHY",
          "CONNECTOR_UNHEALTHY",
          "ERROR_SPIKE",
          "STORAGE_ISSUE",
          "NO_PROGRESS_LOOP",
          "TURNS_ABOVE_EXPECTED",
          "MISSION_OVERTIME",
          "INJECTION_DETECTED",
          "TAMPER_DETECTED",
          "HONEYTOKEN_READ"
        ]
      },
      "AlertSeverity": {
        "title": "AlertSeverity",
        "type": "string",
        "enum": [
          "INFO",
          "WARNING",
          "ERROR",
          "CRITICAL"
        ]
      },
      "AlertState": {
        "title": "AlertState",
        "type": "string",
        "enum": [
          "OPEN",
          "RESOLVED"
        ]
      },
      "Severity": {
        "title": "Severity",
        "type": "string",
        "enum": [
          "DEBUG",
          "INFO",
          "WARNING",
          "ERROR",
          "CRITICAL"
        ]
      },
      "Component": {
        "title": "Component",
        "type": "string",
        "enum": [
          "CONNECTOR_GATEWAY",
          "CONNECTOR",
          "MODEL",
          "TOOL",
          "BROWSER",
          "COMPUTER",
          "MEMORY",
          "MISSION",
          "BUDGET",
          "COST",
          "CONFIG",
          "STORAGE",
          "HEALTH",
          "DIAGNOSTICS"
        ]
      },
      "EventCategory": {
        "title": "EventCategory",
        "type": "string",
        "enum": [
          "INVOCATION",
          "POLICY",
          "BUDGET",
          "RATE_LIMIT",
          "RETRY",
          "HEALTH",
          "CONFIG",
          "LIFECYCLE",
          "SECURITY",
          "DIAGNOSTICS"
        ]
      },
      "EventProvenance": {
        "title": "EventProvenance",
        "type": "string",
        "enum": [
          "LOCALLY_MEASURED",
          "PROVIDER_REPORTED",
          "CONNECTOR_REPORTED"
        ]
      },
      "ConfigLayer": {
        "title": "ConfigLayer",
        "type": "string",
        "enum": [
          "USER",
          "PROJECT",
          "MISSION",
          "SECURITY"
        ],
        "description": "DEFAULT lives in code and is not writable."
      },
      "ValueSource": {
        "title": "ValueSource",
        "type": "string",
        "enum": [
          "DEFAULT",
          "USER",
          "PROJECT",
          "MISSION",
          "SECURITY_CLAMP"
        ]
      },
      "SettingKind": {
        "title": "SettingKind",
        "type": "string",
        "enum": [
          "BOOLEAN",
          "INTEGER",
          "DECIMAL",
          "ENUM",
          "STRING",
          "DURATION",
          "BYTES",
          "LIST"
        ]
      },
      "SettingState": {
        "title": "SettingState",
        "type": "string",
        "enum": [
          "EDITABLE",
          "LOCKED",
          "UNAVAILABLE_THIS_PHASE"
        ]
      },
      "Applies": {
        "title": "Applies",
        "type": "string",
        "enum": [
          "NEXT_OPERATION",
          "NEXT_MISSION",
          "IMMEDIATELY"
        ]
      },
      "ConfigSection": {
        "title": "ConfigSection",
        "type": "string",
        "enum": [
          "GENERAL",
          "APPEARANCE",
          "LANGUAGE",
          "MODELS",
          "PROVIDERS",
          "AGENTS",
          "SKILLS",
          "TOOLS",
          "MCP",
          "MEMORY",
          "BROWSER",
          "COMPUTER",
          "CONNECTORS",
          "PRIVACY",
          "SECURITY",
          "BUDGETS",
          "COST",
          "OBSERVABILITY",
          "ADVANCED"
        ]
      },
      "SettingKey": {
        "title": "SettingKey",
        "type": "string",
        "pattern": "^[a-z]+\\.[a-z0-9_]{2,80}$"
      },
      "SettingValue": {
        "title": "SettingValue",
        "anyOf": [
          {
            "type": "boolean"
          },
          {
            "type": "integer"
          },
          {
            "type": "string",
            "maxLength": 400
          },
          {
            "type": "array",
            "minItems": 0,
            "maxItems": 32,
            "items": {
              "type": "string",
              "minLength": 1,
              "maxLength": 120
            }
          }
        ],
        "description": "A typed value in its plain JSON form: boolean, integer, decimal or code as text, or a list of short strings. The host parses it against the setting's kind and bounds."
      },
      "ConfigState": {
        "title": "ConfigState",
        "type": "string",
        "enum": [
          "OK",
          "UNSUPPORTED_VERSION",
          "UNREADABLE"
        ]
      },
      "ReasonCode": {
        "title": "ReasonCode",
        "type": "string",
        "pattern": "^[A-Za-z0-9_.:-]{1,80}$"
      },
      "OperationParamV1": {
        "title": "OperationParamV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "name",
          "location",
          "kind",
          "required"
        ],
        "properties": {
          "name": {
            "type": "string",
            "pattern": "^[a-z][a-z0-9_]{0,39}$"
          },
          "location": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/ParamLocation"
          },
          "kind": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/ParamKind"
          },
          "required": {
            "type": "boolean"
          },
          "max_length": {
            "anyOf": [
              {
                "type": "integer",
                "minimum": 1,
                "maximum": 4000
              },
              {
                "type": "null"
              }
            ]
          },
          "minimum": {
            "anyOf": [
              {
                "type": "integer"
              },
              {
                "type": "null"
              }
            ]
          },
          "maximum": {
            "anyOf": [
              {
                "type": "integer"
              },
              {
                "type": "null"
              }
            ]
          },
          "allowed": {
            "type": "array",
            "minItems": 0,
            "maxItems": 32,
            "items": {
              "type": "string",
              "minLength": 1,
              "maxLength": 64
            }
          }
        }
      },
      "IdempotencySupportV1": {
        "title": "IdempotencySupportV1",
        "oneOf": [
          {
            "title": "IdempotencyNone",
            "type": "object",
            "additionalProperties": false,
            "required": [
              "mode"
            ],
            "properties": {
              "mode": {
                "const": "NONE"
              }
            }
          },
          {
            "title": "IdempotencyHeader",
            "type": "object",
            "additionalProperties": false,
            "required": [
              "mode",
              "header"
            ],
            "properties": {
              "mode": {
                "const": "HEADER"
              },
              "header": {
                "type": "string",
                "pattern": "^[A-Za-z][A-Za-z0-9-]{0,63}$"
              }
            }
          }
        ]
      },
      "JsonPointer": {
        "title": "JsonPointer",
        "type": "string",
        "pattern": "^/[^\\s]{0,119}$"
      },
      "ConnectorOperationV1": {
        "title": "ConnectorOperationV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "operation_id",
          "title",
          "action",
          "method",
          "path"
        ],
        "properties": {
          "operation_id": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/OperationId"
          },
          "title": {
            "type": "string",
            "minLength": 1,
            "maxLength": 120
          },
          "action": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/OperationAction"
          },
          "method": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/HttpMethod"
          },
          "path": {
            "type": "string",
            "pattern": "^/[A-Za-z0-9._~{}/-]{0,199}$"
          },
          "params": {
            "type": "array",
            "minItems": 0,
            "maxItems": 16,
            "items": {
              "$ref": "./desktop-p06-domain.schema.json#/$defs/OperationParamV1"
            }
          },
          "idempotency": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/IdempotencySupportV1"
          },
          "resource_id_pointer": {
            "anyOf": [
              {
                "$ref": "./desktop-p06-domain.schema.json#/$defs/JsonPointer"
              },
              {
                "type": "null"
              }
            ]
          },
          "result_fields": {
            "type": "array",
            "minItems": 0,
            "maxItems": 8,
            "items": {
              "$ref": "./desktop-p06-domain.schema.json#/$defs/JsonPointer"
            }
          },
          "cost_pointer": {
            "anyOf": [
              {
                "$ref": "./desktop-p06-domain.schema.json#/$defs/JsonPointer"
              },
              {
                "type": "null"
              }
            ]
          },
          "cost_currency": {
            "anyOf": [
              {
                "$ref": "./desktop-p06-domain.schema.json#/$defs/Currency"
              },
              {
                "type": "null"
              }
            ]
          },
          "list_pointer": {
            "anyOf": [
              {
                "$ref": "./desktop-p06-domain.schema.json#/$defs/JsonPointer"
              },
              {
                "type": "null"
              }
            ],
            "description": "PHASE-05: a JSON pointer to a list in the response; its items reach the agent as bounded untrusted data."
          },
          "item_fields": {
            "type": "array",
            "minItems": 0,
            "maxItems": 8,
            "items": {
              "$ref": "./desktop-p06-domain.schema.json#/$defs/JsonPointer"
            },
            "description": "PHASE-05: the fields read from each list item."
          }
        },
        "description": "One registered operation: a fixed path template on the connector's base URL, a fixed method and typed arguments. It names no host and no header."
      },
      "ConnectorProvenanceV1": {
        "title": "ConnectorProvenanceV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "origin",
          "import_id",
          "spec_digest",
          "registered_at"
        ],
        "properties": {
          "origin": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/ProvenanceOrigin"
          },
          "import_id": {
            "anyOf": [
              {
                "$ref": "./common/ids.schema.json#/$defs/Uuid"
              },
              {
                "type": "null"
              }
            ]
          },
          "spec_digest": {
            "anyOf": [
              {
                "$ref": "./common/ids.schema.json#/$defs/Sha256Hex"
              },
              {
                "type": "null"
              }
            ]
          },
          "registered_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          }
        }
      },
      "ConnectorCapabilityV1": {
        "title": "ConnectorCapabilityV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "operation_id",
          "action",
          "title"
        ],
        "properties": {
          "operation_id": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/OperationId"
          },
          "action": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/OperationAction"
          },
          "title": {
            "type": "string",
            "minLength": 1,
            "maxLength": 120
          }
        }
      },
      "ConnectorDescriptorV1": {
        "title": "ConnectorDescriptorV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "connector_id",
          "provider",
          "display_name_key",
          "display_name",
          "description_key",
          "version",
          "category",
          "capabilities",
          "auth_mode",
          "effects",
          "risk_class",
          "supports_read",
          "supports_write",
          "supports_webhook",
          "supports_polling",
          "supports_search",
          "supports_files",
          "enabled",
          "status",
          "provenance",
          "egress_class"
        ],
        "properties": {
          "connector_id": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/ConnectorId"
          },
          "provider": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/ConnectorProvider"
          },
          "display_name_key": {
            "type": "string",
            "minLength": 1,
            "maxLength": 120
          },
          "display_name": {
            "type": "string",
            "minLength": 1,
            "maxLength": 120
          },
          "description_key": {
            "type": "string",
            "minLength": 1,
            "maxLength": 120
          },
          "version": {
            "type": "string",
            "minLength": 1,
            "maxLength": 40
          },
          "category": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/ConnectorCategory"
          },
          "capabilities": {
            "type": "array",
            "minItems": 0,
            "maxItems": 32,
            "items": {
              "$ref": "./desktop-p06-domain.schema.json#/$defs/ConnectorCapabilityV1"
            }
          },
          "auth_mode": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/AuthMode"
          },
          "effects": {
            "type": "array",
            "minItems": 0,
            "maxItems": 10,
            "items": {
              "$ref": "./desktop-p04-domain.schema.json#/$defs/ToolEffect"
            }
          },
          "risk_class": {
            "$ref": "./desktop-p04-domain.schema.json#/$defs/RiskClass"
          },
          "supports_read": {
            "type": "boolean"
          },
          "supports_write": {
            "type": "boolean"
          },
          "supports_webhook": {
            "type": "boolean"
          },
          "supports_polling": {
            "type": "boolean"
          },
          "supports_search": {
            "type": "boolean"
          },
          "supports_files": {
            "type": "boolean"
          },
          "enabled": {
            "type": "boolean"
          },
          "status": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/ConnectorStatus"
          },
          "provenance": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/ConnectorProvenanceV1"
          },
          "egress_class": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/EgressClass"
          }
        }
      },
      "ConnectorAuthStateV1": {
        "title": "ConnectorAuthStateV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "mode",
          "required",
          "configured",
          "source",
          "store_available"
        ],
        "properties": {
          "mode": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/AuthMode"
          },
          "required": {
            "type": "boolean"
          },
          "configured": {
            "type": "boolean"
          },
          "source": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/KeySource"
          },
          "reference": {
            "type": "string",
            "pattern": "^secret://connectors/[0-9a-f-]{36}/default$"
          },
          "environment_variable": {
            "type": "string",
            "pattern": "^POLARIS_CONNECTOR_[A-Z0-9_]{1,40}$"
          },
          "last_updated": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          },
          "store_available": {
            "type": "boolean"
          }
        },
        "description": "Whether a key is configured, where it comes from and when it was last set. There is no value field and no length field."
      },
      "HealthRecordV1": {
        "title": "HealthRecordV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "subject",
          "subject_id",
          "state",
          "reason_code",
          "measured_this_session"
        ],
        "properties": {
          "subject": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/HealthSubject"
          },
          "subject_id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 120
          },
          "state": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/HealthState"
          },
          "reason_code": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/ReasonCode"
          },
          "measured_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          },
          "latency_ms": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "measured_this_session": {
            "type": "boolean"
          }
        }
      },
      "RestViewV1": {
        "title": "RestViewV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "base_url",
          "egress_class",
          "allowed_paths",
          "allowed_methods",
          "timeout_ms",
          "max_response_bytes",
          "requests_per_minute",
          "max_concurrent"
        ],
        "properties": {
          "base_url": {
            "type": "string",
            "minLength": 1,
            "maxLength": 300
          },
          "egress_class": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/EgressClass"
          },
          "allowed_paths": {
            "type": "array",
            "minItems": 1,
            "maxItems": 32,
            "items": {
              "type": "string",
              "minLength": 1,
              "maxLength": 200
            }
          },
          "allowed_methods": {
            "type": "array",
            "minItems": 1,
            "maxItems": 5,
            "items": {
              "$ref": "./desktop-p06-domain.schema.json#/$defs/HttpMethod"
            }
          },
          "timeout_ms": {
            "type": "integer",
            "minimum": 1000,
            "maximum": 60000
          },
          "max_response_bytes": {
            "type": "integer",
            "minimum": 1024,
            "maximum": 4194304
          },
          "requests_per_minute": {
            "type": "integer",
            "minimum": 1,
            "maximum": 600
          },
          "max_concurrent": {
            "type": "integer",
            "minimum": 1,
            "maximum": 8
          }
        }
      },
      "WorkspaceConfigV1": {
        "title": "WorkspaceConfigV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "project_id"
        ],
        "properties": {
          "project_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          }
        }
      },
      "ConnectorViewV1": {
        "title": "ConnectorViewV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "descriptor",
          "auth",
          "health",
          "operation_count",
          "registered_at"
        ],
        "properties": {
          "descriptor": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/ConnectorDescriptorV1"
          },
          "auth": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/ConnectorAuthStateV1"
          },
          "health": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/HealthRecordV1"
          },
          "last_activity_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          },
          "operation_count": {
            "type": "integer",
            "minimum": 0,
            "maximum": 32
          },
          "rest": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/RestViewV1"
          },
          "workspace": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/WorkspaceConfigV1"
          },
          "registered_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          }
        }
      },
      "OperationViewV1": {
        "title": "OperationViewV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "operation",
          "tool_id",
          "side_effect",
          "retry_safe"
        ],
        "properties": {
          "operation": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/ConnectorOperationV1"
          },
          "tool_id": {
            "$ref": "./desktop-p04-domain.schema.json#/$defs/ToolId"
          },
          "side_effect": {
            "type": "boolean"
          },
          "retry_safe": {
            "type": "boolean"
          }
        }
      },
      "ConnectorInvocationV1": {
        "title": "ConnectorInvocationV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "invocation_id",
          "connector_id",
          "operation_id",
          "action",
          "status",
          "attempts",
          "resource_refs",
          "summary",
          "latency_ms",
          "started_at"
        ],
        "properties": {
          "invocation_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "connector_id": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/ConnectorId"
          },
          "operation_id": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/OperationId"
          },
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "task_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "action": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/OperationAction"
          },
          "status": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/InvocationOutcome"
          },
          "attempts": {
            "type": "integer",
            "minimum": 0,
            "maximum": 10
          },
          "http_status": {
            "type": "integer",
            "minimum": 100,
            "maximum": 999
          },
          "reason_code": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/ReasonCode"
          },
          "result_digest": {
            "$ref": "./common/ids.schema.json#/$defs/Sha256Hex"
          },
          "resource_refs": {
            "type": "array",
            "minItems": 0,
            "maxItems": 8,
            "items": {
              "type": "string",
              "minLength": 1,
              "maxLength": 160
            }
          },
          "summary": {
            "type": "string",
            "minLength": 0,
            "maxLength": 1200
          },
          "latency_ms": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "started_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          }
        },
        "description": "One connector call as recorded: a bounded summary of untrusted content, never the raw body."
      },
      "RejectedOperationV1": {
        "title": "RejectedOperationV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "method",
          "path",
          "reason"
        ],
        "properties": {
          "method": {
            "type": "string",
            "minLength": 1,
            "maxLength": 10
          },
          "path": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200
          },
          "reason": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/ReasonCode"
          }
        }
      },
      "CostV1": {
        "title": "CostV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "micros",
          "currency",
          "provenance",
          "pricing_source"
        ],
        "properties": {
          "micros": {
            "anyOf": [
              {
                "type": "integer",
                "minimum": 0,
                "maximum": 9007199254740991
              },
              {
                "type": "null"
              }
            ]
          },
          "currency": {
            "anyOf": [
              {
                "$ref": "./desktop-p06-domain.schema.json#/$defs/Currency"
              },
              {
                "type": "null"
              }
            ]
          },
          "provenance": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/CostProvenance"
          },
          "pricing_source": {
            "anyOf": [
              {
                "type": "string",
                "minLength": 1,
                "maxLength": 200
              },
              {
                "type": "null"
              }
            ]
          }
        },
        "description": "An amount in millionths of a currency unit with its provenance. UNKNOWN has no amount.",
        "allOf": [
          {
            "if": {
              "properties": {
                "provenance": {
                  "const": "UNKNOWN"
                }
              }
            },
            "then": {
              "properties": {
                "micros": {
                  "type": "null"
                }
              }
            }
          }
        ]
      },
      "CostBucketV1": {
        "title": "CostBucketV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "currency",
          "provenance",
          "micros",
          "calls"
        ],
        "properties": {
          "currency": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/Currency"
          },
          "provenance": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/CostProvenance"
          },
          "micros": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "calls": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          }
        }
      },
      "UsageTotalsV1": {
        "title": "UsageTotalsV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "key",
          "calls",
          "input_tokens_reported",
          "output_tokens_reported",
          "calls_without_reported_tokens",
          "wall_ms",
          "external_requests",
          "costs",
          "calls_with_unknown_cost"
        ],
        "properties": {
          "key": {
            "type": "string",
            "minLength": 1,
            "maxLength": 320
          },
          "calls": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "input_tokens_reported": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "output_tokens_reported": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "calls_without_reported_tokens": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "wall_ms": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "external_requests": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "costs": {
            "type": "array",
            "minItems": 0,
            "maxItems": 64,
            "items": {
              "$ref": "./desktop-p06-domain.schema.json#/$defs/CostBucketV1"
            }
          },
          "calls_with_unknown_cost": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          }
        },
        "description": "Totals kept apart by currency and provenance: an estimate and a report are never summed into one number."
      },
      "UsageRecordV1": {
        "title": "UsageRecordV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "record_id",
          "recorded_at",
          "category",
          "subject_id",
          "mission_id",
          "project_id",
          "provider_id",
          "model_id",
          "connector_id",
          "tool_id",
          "input_tokens",
          "output_tokens",
          "cached_tokens",
          "tokens_provenance",
          "wall_ms",
          "external_requests",
          "cost"
        ],
        "properties": {
          "record_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "recorded_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          },
          "category": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/UsageCategory"
          },
          "subject_id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 160
          },
          "mission_id": {
            "anyOf": [
              {
                "$ref": "./common/ids.schema.json#/$defs/Uuid"
              },
              {
                "type": "null"
              }
            ]
          },
          "project_id": {
            "anyOf": [
              {
                "$ref": "./common/ids.schema.json#/$defs/Uuid"
              },
              {
                "type": "null"
              }
            ]
          },
          "provider_id": {
            "anyOf": [
              {
                "type": "string",
                "minLength": 1,
                "maxLength": 120
              },
              {
                "type": "null"
              }
            ]
          },
          "model_id": {
            "anyOf": [
              {
                "type": "string",
                "minLength": 1,
                "maxLength": 300
              },
              {
                "type": "null"
              }
            ]
          },
          "connector_id": {
            "anyOf": [
              {
                "$ref": "./common/ids.schema.json#/$defs/Uuid"
              },
              {
                "type": "null"
              }
            ]
          },
          "tool_id": {
            "anyOf": [
              {
                "$ref": "./desktop-p04-domain.schema.json#/$defs/ToolId"
              },
              {
                "type": "null"
              }
            ]
          },
          "input_tokens": {
            "anyOf": [
              {
                "type": "integer",
                "minimum": 0,
                "maximum": 9007199254740991
              },
              {
                "type": "null"
              }
            ]
          },
          "output_tokens": {
            "anyOf": [
              {
                "type": "integer",
                "minimum": 0,
                "maximum": 9007199254740991
              },
              {
                "type": "null"
              }
            ]
          },
          "cached_tokens": {
            "anyOf": [
              {
                "type": "integer",
                "minimum": 0,
                "maximum": 9007199254740991
              },
              {
                "type": "null"
              }
            ]
          },
          "tokens_provenance": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/CostProvenance"
          },
          "wall_ms": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "external_requests": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "cost": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/CostV1"
          }
        }
      },
      "BudgetV1": {
        "title": "BudgetV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "budget_id",
          "scope",
          "scope_key",
          "dimension",
          "limit",
          "currency",
          "mode",
          "warn_ratio_pct",
          "created_at",
          "updated_at"
        ],
        "properties": {
          "budget_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "scope": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/BudgetScope"
          },
          "scope_key": {
            "type": "string",
            "minLength": 0,
            "maxLength": 200
          },
          "dimension": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/BudgetDimension"
          },
          "limit": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "currency": {
            "anyOf": [
              {
                "$ref": "./desktop-p06-domain.schema.json#/$defs/Currency"
              },
              {
                "type": "null"
              }
            ]
          },
          "mode": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/BudgetMode"
          },
          "warn_ratio_pct": {
            "type": "integer",
            "minimum": 1,
            "maximum": 100
          },
          "created_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          },
          "updated_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          }
        }
      },
      "BudgetUseV1": {
        "title": "BudgetUseV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "budget_id",
          "scope",
          "scope_key",
          "dimension",
          "mode",
          "limit",
          "used",
          "reserved",
          "unmetered_calls",
          "state"
        ],
        "properties": {
          "budget_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "scope": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/BudgetScope"
          },
          "scope_key": {
            "type": "string",
            "minLength": 0,
            "maxLength": 200
          },
          "dimension": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/BudgetDimension"
          },
          "mode": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/BudgetMode"
          },
          "limit": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "used": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "reserved": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "currency": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/Currency"
          },
          "unmetered_calls": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "state": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/BudgetState"
          }
        }
      },
      "PricingEntryV1": {
        "title": "PricingEntryV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "pricing_id",
          "target_kind",
          "target_id",
          "unit",
          "amount_micros",
          "currency",
          "source_note",
          "created_at"
        ],
        "properties": {
          "pricing_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "target_kind": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/PricingTarget"
          },
          "target_id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200
          },
          "unit": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/PricingUnit"
          },
          "amount_micros": {
            "type": "integer",
            "minimum": 0,
            "maximum": 1000000000000
          },
          "currency": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/Currency"
          },
          "source_note": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200
          },
          "created_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          }
        }
      },
      "PricingViewV1": {
        "title": "PricingViewV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "entry",
          "amount",
          "provenance"
        ],
        "properties": {
          "entry": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/PricingEntryV1"
          },
          "amount": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/DecimalText"
          },
          "provenance": {
            "const": "ESTIMATED"
          }
        },
        "description": "A user-entered price. Every cost computed from it is ESTIMATED, never an invoice."
      },
      "ObsEventV1": {
        "title": "ObsEventV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "event_id",
          "timestamp",
          "component",
          "category",
          "severity",
          "operation",
          "result",
          "provenance"
        ],
        "properties": {
          "event_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "timestamp": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          },
          "component": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/Component"
          },
          "category": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/EventCategory"
          },
          "severity": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/Severity"
          },
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "task_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "agent_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "operation": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_.:-]{1,120}$"
          },
          "result": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_.:-]{1,40}$"
          },
          "duration_ms": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "reason_code": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/ReasonCode"
          },
          "provenance": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/EventProvenance"
          }
        },
        "description": "A structured diagnostic event: codes only. No prompt text, secret, header, page content or connector payload can be represented."
      },
      "HistogramV1": {
        "title": "HistogramV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "buckets",
          "count",
          "sum_ms",
          "max_ms"
        ],
        "properties": {
          "buckets": {
            "type": "array",
            "minItems": 10,
            "maxItems": 10,
            "items": {
              "type": "integer",
              "minimum": 0,
              "maximum": 9007199254740991
            }
          },
          "count": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "sum_ms": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "max_ms": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          }
        }
      },
      "LatencyViewV1": {
        "title": "LatencyViewV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "component",
          "bucket_bounds_ms",
          "histogram"
        ],
        "properties": {
          "component": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/Component"
          },
          "bucket_bounds_ms": {
            "type": "array",
            "minItems": 9,
            "maxItems": 9,
            "items": {
              "type": "integer",
              "minimum": 0,
              "maximum": 9007199254740991
            }
          },
          "histogram": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/HistogramV1"
          },
          "mean_ms": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          }
        }
      },
      "ErrorGroupV1": {
        "title": "ErrorGroupV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "component",
          "reason_code",
          "count"
        ],
        "properties": {
          "component": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/Component"
          },
          "reason_code": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/ReasonCode"
          },
          "count": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          }
        }
      },
      "MetricCountersV1": {
        "title": "MetricCountersV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "mission_count",
          "mission_success_count",
          "mission_failed_count",
          "model_calls",
          "tool_calls",
          "connector_calls",
          "approval_requests",
          "approval_denials",
          "browser_actions",
          "computer_actions",
          "memory_writes",
          "errors"
        ],
        "properties": {
          "mission_count": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "mission_success_count": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "mission_failed_count": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "model_calls": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "tool_calls": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "connector_calls": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "approval_requests": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "approval_denials": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "browser_actions": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "computer_actions": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "memory_writes": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "errors": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          }
        }
      },
      "MetricsSnapshotV1": {
        "title": "MetricsSnapshotV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "scope",
          "counters",
          "latency",
          "errors_by_code",
          "error_overflow",
          "distinct_error_keys"
        ],
        "properties": {
          "scope": {
            "const": "SINCE_START"
          },
          "counters": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/MetricCountersV1"
          },
          "latency": {
            "type": "array",
            "minItems": 0,
            "maxItems": 14,
            "items": {
              "$ref": "./desktop-p06-domain.schema.json#/$defs/LatencyViewV1"
            }
          },
          "errors_by_code": {
            "type": "array",
            "minItems": 0,
            "maxItems": 200,
            "items": {
              "$ref": "./desktop-p06-domain.schema.json#/$defs/ErrorGroupV1"
            }
          },
          "error_overflow": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "distinct_error_keys": {
            "type": "integer",
            "minimum": 0,
            "maximum": 200
          }
        }
      },
      "QueueDepthsV1": {
        "title": "QueueDepthsV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "running_missions",
          "running_model_requests",
          "pending_approvals",
          "connector_requests_in_flight"
        ],
        "properties": {
          "running_missions": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "running_model_requests": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "pending_approvals": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "connector_requests_in_flight": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          }
        }
      },
      "AlertV1": {
        "title": "AlertV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "alert_id",
          "kind",
          "severity",
          "subject",
          "reason_code",
          "first_at",
          "last_at",
          "occurrences",
          "state"
        ],
        "properties": {
          "alert_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "kind": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/AlertKind"
          },
          "severity": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/AlertSeverity"
          },
          "subject": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200
          },
          "reason_code": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/ReasonCode"
          },
          "first_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          },
          "last_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          },
          "occurrences": {
            "type": "integer",
            "minimum": 1,
            "maximum": 9007199254740991
          },
          "state": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/AlertState"
          }
        }
      },
      "HealthOverviewV1": {
        "title": "HealthOverviewV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "measured_at",
          "overall",
          "components"
        ],
        "properties": {
          "measured_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          },
          "overall": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/HealthState"
          },
          "components": {
            "type": "array",
            "minItems": 0,
            "maxItems": 200,
            "items": {
              "$ref": "./desktop-p06-domain.schema.json#/$defs/HealthRecordV1"
            }
          }
        }
      },
      "ResolvedValueV1": {
        "title": "ResolvedValueV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "key",
          "value",
          "source",
          "clamped",
          "present_layers",
          "ignored_layers"
        ],
        "properties": {
          "key": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/SettingKey"
          },
          "value": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/SettingValue"
          },
          "source": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/ValueSource"
          },
          "clamped": {
            "type": "boolean"
          },
          "present_layers": {
            "type": "array",
            "minItems": 0,
            "maxItems": 4,
            "items": {
              "$ref": "./desktop-p06-domain.schema.json#/$defs/ConfigLayer"
            }
          },
          "ignored_layers": {
            "type": "array",
            "minItems": 0,
            "maxItems": 4,
            "items": {
              "$ref": "./desktop-p06-domain.schema.json#/$defs/ConfigLayer"
            }
          },
          "clamp": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/SettingValue"
          }
        },
        "description": "One effective value and where it came from. ignored_layers lists a project or mission value that tried to widen a security-bearing setting."
      },
      "SettingBoundsV1": {
        "title": "SettingBoundsV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "min",
          "max",
          "min_decimal",
          "max_decimal",
          "allowed",
          "max_length",
          "max_items"
        ],
        "properties": {
          "min": {
            "anyOf": [
              {
                "type": "integer"
              },
              {
                "type": "null"
              }
            ]
          },
          "max": {
            "anyOf": [
              {
                "type": "integer"
              },
              {
                "type": "null"
              }
            ]
          },
          "min_decimal": {
            "anyOf": [
              {
                "type": "string",
                "maxLength": 30
              },
              {
                "type": "null"
              }
            ]
          },
          "max_decimal": {
            "anyOf": [
              {
                "type": "string",
                "maxLength": 30
              },
              {
                "type": "null"
              }
            ]
          },
          "allowed": {
            "type": "array",
            "minItems": 0,
            "maxItems": 32,
            "items": {
              "type": "string",
              "minLength": 1,
              "maxLength": 64
            }
          },
          "max_length": {
            "anyOf": [
              {
                "type": "integer",
                "minimum": 0,
                "maximum": 9007199254740991
              },
              {
                "type": "null"
              }
            ]
          },
          "max_items": {
            "anyOf": [
              {
                "type": "integer",
                "minimum": 0,
                "maximum": 9007199254740991
              },
              {
                "type": "null"
              }
            ]
          }
        }
      },
      "SettingDescriptorV1": {
        "title": "SettingDescriptorV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "key",
          "kind",
          "state",
          "default",
          "layers",
          "security_bearing",
          "ceiling",
          "applies",
          "consumer",
          "label_key",
          "hint_key",
          "bounds"
        ],
        "properties": {
          "key": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/SettingKey"
          },
          "kind": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/SettingKind"
          },
          "state": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/SettingState"
          },
          "default": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/SettingValue"
          },
          "layers": {
            "type": "array",
            "minItems": 0,
            "maxItems": 4,
            "items": {
              "$ref": "./desktop-p06-domain.schema.json#/$defs/ConfigLayer"
            }
          },
          "security_bearing": {
            "type": "boolean"
          },
          "ceiling": {
            "anyOf": [
              {
                "$ref": "./desktop-p06-domain.schema.json#/$defs/SettingValue"
              },
              {
                "type": "null"
              }
            ]
          },
          "applies": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/Applies"
          },
          "consumer": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200
          },
          "label_key": {
            "type": "string",
            "minLength": 1,
            "maxLength": 160
          },
          "hint_key": {
            "type": "string",
            "minLength": 1,
            "maxLength": 160
          },
          "bounds": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/SettingBoundsV1"
          }
        },
        "description": "A typed setting: its kind, bounds, the layers that may write it, whether it bears security, its build ceiling and the host component that reads it. It carries no current value."
      },
      "ConfigStatusV1": {
        "title": "ConfigStatusV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "state",
          "schema_version",
          "found_version",
          "unreadable_rows",
          "config_version"
        ],
        "properties": {
          "state": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/ConfigState"
          },
          "schema_version": {
            "type": "integer",
            "minimum": 1,
            "maximum": 9007199254740991
          },
          "found_version": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "unreadable_rows": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "config_version": {
            "type": "integer",
            "minimum": 1,
            "maximum": 9007199254740991
          }
        }
      },
      "SensitiveStatusV1": {
        "title": "SensitiveStatusV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "subject",
          "configured",
          "source",
          "reference"
        ],
        "properties": {
          "subject": {
            "type": "string",
            "pattern": "^(provider|connector):[A-Za-z0-9._-]{1,80}$"
          },
          "configured": {
            "type": "boolean"
          },
          "source": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/KeySource"
          },
          "reference": {
            "anyOf": [
              {
                "type": "string",
                "minLength": 1,
                "maxLength": 200
              },
              {
                "type": "null"
              }
            ]
          },
          "last_updated": {
            "anyOf": [
              {
                "$ref": "./common/ids.schema.json#/$defs/Timestamp"
              },
              {
                "type": "null"
              }
            ]
          }
        },
        "description": "A sensitive setting shown as configured, source and last update only. There is no reveal path."
      },
      "PresetId": {
        "title": "PresetId",
        "type": "string",
        "pattern": "^[a-z0-9][a-z0-9._-]{1,63}$"
      },
      "ConnectorPresetOperationV1": {
        "title": "ConnectorPresetOperationV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "operation_id",
          "title",
          "action"
        ],
        "properties": {
          "operation_id": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/OperationId"
          },
          "title": {
            "type": "string",
            "minLength": 1,
            "maxLength": 120
          },
          "action": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/OperationAction"
          }
        }
      },
      "ConnectorPresetV1": {
        "title": "ConnectorPresetV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "preset_id",
          "display_name",
          "category",
          "description",
          "base_url",
          "auth_mode",
          "setup_hint",
          "docs_url",
          "operations"
        ],
        "properties": {
          "preset_id": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/PresetId"
          },
          "display_name": {
            "type": "string",
            "minLength": 1,
            "maxLength": 120
          },
          "category": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/ConnectorCategory"
          },
          "description": {
            "type": "string",
            "minLength": 1,
            "maxLength": 400
          },
          "base_url": {
            "type": "string",
            "pattern": "^https://[a-z0-9.-]+$"
          },
          "auth_mode": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/AuthMode"
          },
          "setup_hint": {
            "type": "string",
            "minLength": 1,
            "maxLength": 600
          },
          "docs_url": {
            "type": "string",
            "pattern": "^https://[^\\s]{1,300}$"
          },
          "operations": {
            "type": "array",
            "minItems": 1,
            "maxItems": 32,
            "items": {
              "$ref": "./desktop-p06-domain.schema.json#/$defs/ConnectorPresetOperationV1"
            }
          }
        },
        "description": "A built-in connector preset: the service's official base URL and documented read operations. It carries no credential and no connection state."
      }
    }
  } as unknown as SchemaDocument,
  "desktop-p06-request.v1.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "DesktopPhase06RequestPayloadV1",
    "description": "The closed set of request payloads the thirty Phase-06 operations accept. No payload can execute a connector operation, name a free URL for an agent, or carry a credential value.",
    "$comment": "لا نداء موصل من العارض، ولا سرّ في حمولة، ولا عنوان حرّ. عملية الموصل تبدأ من زمن تشغيل المهمّة عبر البوابتين.",
    "anyOf": [
      {
        "$ref": "#/$defs/ConnectorListRequestV1"
      },
      {
        "$ref": "#/$defs/ConnectorGetRequestV1"
      },
      {
        "$ref": "#/$defs/ConnectorRegisterRequestV1"
      },
      {
        "$ref": "#/$defs/ConnectorConfigureRequestV1"
      },
      {
        "$ref": "#/$defs/ConnectorRemoveRequestV1"
      },
      {
        "$ref": "#/$defs/ConnectorTestRequestV1"
      },
      {
        "$ref": "#/$defs/ConnectorCredentialSetRequestV1"
      },
      {
        "$ref": "#/$defs/ConnectorCredentialClearRequestV1"
      },
      {
        "$ref": "#/$defs/ConnectorOpenapiImportRequestV1"
      },
      {
        "$ref": "#/$defs/ConnectorOpenapiApproveRequestV1"
      },
      {
        "$ref": "#/$defs/ConnectorPresetListRequestV1"
      },
      {
        "$ref": "#/$defs/ConnectorPresetRegisterRequestV1"
      },
      {
        "$ref": "#/$defs/UsageSummaryRequestV1"
      },
      {
        "$ref": "#/$defs/UsageListRequestV1"
      },
      {
        "$ref": "#/$defs/BudgetListRequestV1"
      },
      {
        "$ref": "#/$defs/BudgetSetRequestV1"
      },
      {
        "$ref": "#/$defs/BudgetRemoveRequestV1"
      },
      {
        "$ref": "#/$defs/PricingListRequestV1"
      },
      {
        "$ref": "#/$defs/PricingSetRequestV1"
      },
      {
        "$ref": "#/$defs/PricingRemoveRequestV1"
      },
      {
        "$ref": "#/$defs/ObservabilityHealthRequestV1"
      },
      {
        "$ref": "#/$defs/ObservabilityEventsRequestV1"
      },
      {
        "$ref": "#/$defs/ObservabilityMetricsRequestV1"
      },
      {
        "$ref": "#/$defs/ObservabilityErrorsRequestV1"
      },
      {
        "$ref": "#/$defs/ObservabilityAlertsRequestV1"
      },
      {
        "$ref": "#/$defs/DiagnosticsExportRequestV1"
      },
      {
        "$ref": "#/$defs/ConfigDescribeRequestV1"
      },
      {
        "$ref": "#/$defs/ConfigEffectiveRequestV1"
      },
      {
        "$ref": "#/$defs/ConfigSetRequestV1"
      },
      {
        "$ref": "#/$defs/ConfigResetRequestV1"
      }
    ],
    "$defs": {
      "RestInputV1": {
        "title": "RestInputV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "base_url",
          "egress_class",
          "allowed_paths",
          "allowed_methods",
          "auth_mode",
          "key_source",
          "timeout_ms",
          "max_response_bytes"
        ],
        "properties": {
          "base_url": {
            "type": "string",
            "minLength": 1,
            "maxLength": 300
          },
          "egress_class": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/EgressClass"
          },
          "allowed_paths": {
            "type": "array",
            "minItems": 1,
            "maxItems": 32,
            "items": {
              "type": "string",
              "pattern": "^/[A-Za-z0-9._~{}/-]{0,199}$"
            }
          },
          "allowed_methods": {
            "type": "array",
            "minItems": 1,
            "maxItems": 5,
            "items": {
              "$ref": "./desktop-p06-domain.schema.json#/$defs/HttpMethod"
            }
          },
          "auth_mode": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/AuthMode"
          },
          "key_source": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/KeySource"
          },
          "environment_variable": {
            "type": "string",
            "pattern": "^POLARIS_CONNECTOR_[A-Z0-9_]{1,40}$"
          },
          "key_header": {
            "type": "string",
            "enum": [
              "X-API-Key",
              "Api-Key",
              "X-Auth-Token",
              "X-Access-Token",
              "Ocp-Apim-Subscription-Key"
            ]
          },
          "basic_username": {
            "type": "string",
            "minLength": 1,
            "maxLength": 120
          },
          "timeout_ms": {
            "type": "integer",
            "minimum": 1000,
            "maximum": 60000
          },
          "max_response_bytes": {
            "type": "integer",
            "minimum": 1024,
            "maximum": 4194304
          },
          "requests_per_minute": {
            "type": "integer",
            "minimum": 1,
            "maximum": 600
          },
          "max_concurrent": {
            "type": "integer",
            "minimum": 1,
            "maximum": 8
          }
        },
        "description": "A REST connector as the user registers it from the settings surface. The base URL, paths and methods are fixed here; an agent can only choose among the operations."
      },
      "ConnectorListRequestV1": {
        "title": "ConnectorListRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [],
        "properties": {},
        "description": "Lists registered connectors. No side effect."
      },
      "ConnectorGetRequestV1": {
        "title": "ConnectorGetRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "connector_id"
        ],
        "properties": {
          "connector_id": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/ConnectorId"
          }
        }
      },
      "ConnectorRegisterRequestV1": {
        "title": "ConnectorRegisterRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "provider",
          "category",
          "display_name"
        ],
        "properties": {
          "provider": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/ConnectorProvider"
          },
          "category": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/ConnectorCategory"
          },
          "display_name": {
            "type": "string",
            "minLength": 1,
            "maxLength": 120
          },
          "rest": {
            "$ref": "#/$defs/RestInputV1"
          },
          "workspace": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/WorkspaceConfigV1"
          },
          "operations": {
            "type": "array",
            "minItems": 0,
            "maxItems": 32,
            "items": {
              "$ref": "./desktop-p06-domain.schema.json#/$defs/ConnectorOperationV1"
            }
          }
        },
        "description": "Registers a connector, disabled. Enabling is a separate decision the user sees."
      },
      "ConnectorConfigureRequestV1": {
        "title": "ConnectorConfigureRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "connector_id"
        ],
        "properties": {
          "connector_id": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/ConnectorId"
          },
          "enabled": {
            "type": "boolean"
          },
          "display_name": {
            "type": "string",
            "minLength": 1,
            "maxLength": 120
          },
          "requests_per_minute": {
            "type": "integer",
            "minimum": 1,
            "maximum": 600
          },
          "max_concurrent": {
            "type": "integer",
            "minimum": 1,
            "maximum": 8
          }
        },
        "description": "Enables, disables, renames or re-rates a connector. The destination, paths and operations cannot be edited here."
      },
      "ConnectorRemoveRequestV1": {
        "title": "ConnectorRemoveRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "connector_id"
        ],
        "properties": {
          "connector_id": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/ConnectorId"
          }
        }
      },
      "ConnectorTestRequestV1": {
        "title": "ConnectorTestRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "connector_id"
        ],
        "properties": {
          "connector_id": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/ConnectorId"
          }
        },
        "description": "Measures health with one read operation through the connector gateway."
      },
      "ConnectorCredentialSetRequestV1": {
        "title": "ConnectorCredentialSetRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "connector_id"
        ],
        "properties": {
          "connector_id": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/ConnectorId"
          }
        },
        "description": "Opens the host's own credential prompt. The value is typed into a system window, never into the renderer."
      },
      "ConnectorCredentialClearRequestV1": {
        "title": "ConnectorCredentialClearRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "connector_id"
        ],
        "properties": {
          "connector_id": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/ConnectorId"
          }
        }
      },
      "ConnectorOpenapiImportRequestV1": {
        "title": "ConnectorOpenapiImportRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "spec"
        ],
        "properties": {
          "spec": {
            "type": "string",
            "minLength": 2,
            "maxLength": 524288
          }
        },
        "description": "Parses an OpenAPI 3 document into proposed operations. Nothing is registered."
      },
      "ConnectorOpenapiApproveRequestV1": {
        "title": "ConnectorOpenapiApproveRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "import_id",
          "operation_ids",
          "display_name",
          "category",
          "rest"
        ],
        "properties": {
          "import_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "operation_ids": {
            "type": "array",
            "minItems": 1,
            "maxItems": 32,
            "items": {
              "$ref": "./desktop-p06-domain.schema.json#/$defs/OperationId"
            }
          },
          "display_name": {
            "type": "string",
            "minLength": 1,
            "maxLength": 120
          },
          "category": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/ConnectorCategory"
          },
          "rest": {
            "$ref": "#/$defs/RestInputV1"
          }
        },
        "description": "Registers only the operations the user approved, at a base URL the user confirmed, disabled."
      },
      "UsageSummaryRequestV1": {
        "title": "UsageSummaryRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [],
        "properties": {
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "project_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          }
        }
      },
      "UsageListRequestV1": {
        "title": "UsageListRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [],
        "properties": {
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "category": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/UsageCategory"
          },
          "limit": {
            "type": "integer",
            "minimum": 1,
            "maximum": 500
          }
        }
      },
      "BudgetListRequestV1": {
        "title": "BudgetListRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [],
        "properties": {
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "project_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          }
        }
      },
      "BudgetSetRequestV1": {
        "title": "BudgetSetRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "scope",
          "dimension",
          "limit"
        ],
        "properties": {
          "scope": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/BudgetScope"
          },
          "scope_key": {
            "type": "string",
            "maxLength": 200,
            "pattern": "^[^\\s]*$"
          },
          "dimension": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/BudgetDimension"
          },
          "limit": {
            "anyOf": [
              {
                "type": "integer",
                "minimum": 0,
                "maximum": 9007199254740991
              },
              {
                "$ref": "./desktop-p06-domain.schema.json#/$defs/DecimalText"
              }
            ]
          },
          "currency": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/Currency"
          },
          "mode": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/BudgetMode"
          },
          "warn_ratio_pct": {
            "type": "integer",
            "minimum": 1,
            "maximum": 100
          }
        }
      },
      "BudgetRemoveRequestV1": {
        "title": "BudgetRemoveRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "budget_id"
        ],
        "properties": {
          "budget_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          }
        }
      },
      "PricingListRequestV1": {
        "title": "PricingListRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [],
        "properties": {}
      },
      "PricingSetRequestV1": {
        "title": "PricingSetRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "target_kind",
          "target_id",
          "unit",
          "amount",
          "currency",
          "source_note"
        ],
        "properties": {
          "target_kind": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/PricingTarget"
          },
          "target_id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200,
            "pattern": "^[^\\s]+$"
          },
          "unit": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/PricingUnit"
          },
          "amount": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/DecimalText"
          },
          "currency": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/Currency"
          },
          "source_note": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200
          }
        },
        "description": "A price the user entered, with where it came from. POLARIS ships no price of its own."
      },
      "PricingRemoveRequestV1": {
        "title": "PricingRemoveRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "pricing_id"
        ],
        "properties": {
          "pricing_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          }
        }
      },
      "ObservabilityHealthRequestV1": {
        "title": "ObservabilityHealthRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [],
        "properties": {}
      },
      "ObservabilityEventsRequestV1": {
        "title": "ObservabilityEventsRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [],
        "properties": {
          "limit": {
            "type": "integer",
            "minimum": 1,
            "maximum": 500
          },
          "component": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/Component"
          },
          "min_severity": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/Severity"
          }
        }
      },
      "ObservabilityMetricsRequestV1": {
        "title": "ObservabilityMetricsRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [],
        "properties": {}
      },
      "ObservabilityErrorsRequestV1": {
        "title": "ObservabilityErrorsRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [],
        "properties": {}
      },
      "ObservabilityAlertsRequestV1": {
        "title": "ObservabilityAlertsRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [],
        "properties": {
          "include_resolved": {
            "type": "boolean"
          }
        }
      },
      "DiagnosticsExportRequestV1": {
        "title": "DiagnosticsExportRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [],
        "properties": {},
        "description": "Writes a bounded, redacted local diagnostics document."
      },
      "ConfigDescribeRequestV1": {
        "title": "ConfigDescribeRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [],
        "properties": {}
      },
      "ConfigEffectiveRequestV1": {
        "title": "ConfigEffectiveRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [],
        "properties": {
          "project_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          }
        }
      },
      "ConfigSetRequestV1": {
        "title": "ConfigSetRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "layer",
          "key",
          "value"
        ],
        "properties": {
          "layer": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/ConfigLayer"
          },
          "scope_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "key": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/SettingKey"
          },
          "value": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/SettingValue"
          }
        },
        "description": "Writes one typed value into one layer. The host validates, clamps and refuses widening."
      },
      "ConfigResetRequestV1": {
        "title": "ConfigResetRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "layer",
          "key"
        ],
        "properties": {
          "layer": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/ConfigLayer"
          },
          "scope_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "key": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/SettingKey"
          }
        }
      },
      "ConnectorPresetListRequestV1": {
        "title": "ConnectorPresetListRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [],
        "properties": {},
        "description": "Lists the built-in connector presets. No side effect."
      },
      "ConnectorPresetRegisterRequestV1": {
        "title": "ConnectorPresetRegisterRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "preset_id"
        ],
        "properties": {
          "preset_id": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/PresetId"
          },
          "display_name": {
            "type": "string",
            "minLength": 1,
            "maxLength": 120
          }
        },
        "description": "Registers a built-in preset as a disabled connector without a credential. Its URL, paths, methods and headers come from the host, not from this payload."
      }
    }
  } as unknown as SchemaDocument,
  "desktop-p06-result.v1.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "DesktopPhase06ResultPayloadV1",
    "description": "The closed set of result payloads the thirty Phase-06 operations return. No result carries a credential value, a raw connector body, a free URL chosen by an agent, or an unlabelled estimate.",
    "$comment": "ما يعبر: معرّفات وحالات ورموز وأعداد ومبالغ بمصادرها وملخّصات محدودة. القيمة السرّية والجسم الخام يبقيان في المضيف.",
    "anyOf": [
      {
        "$ref": "#/$defs/ConnectorListResultV1"
      },
      {
        "$ref": "#/$defs/ConnectorGetResultV1"
      },
      {
        "$ref": "#/$defs/ConnectorResultV1"
      },
      {
        "$ref": "#/$defs/ConnectorRemoveResultV1"
      },
      {
        "$ref": "#/$defs/ConnectorTestResultV1"
      },
      {
        "$ref": "#/$defs/ConnectorCredentialResultV1"
      },
      {
        "$ref": "#/$defs/ConnectorOpenapiImportResultV1"
      },
      {
        "$ref": "#/$defs/ConnectorPresetListResultV1"
      },
      {
        "$ref": "#/$defs/UsageSummaryResultV1"
      },
      {
        "$ref": "#/$defs/UsageListResultV1"
      },
      {
        "$ref": "#/$defs/BudgetListResultV1"
      },
      {
        "$ref": "#/$defs/BudgetSetResultV1"
      },
      {
        "$ref": "#/$defs/BudgetRemoveResultV1"
      },
      {
        "$ref": "#/$defs/PricingListResultV1"
      },
      {
        "$ref": "#/$defs/PricingSetResultV1"
      },
      {
        "$ref": "#/$defs/PricingRemoveResultV1"
      },
      {
        "$ref": "#/$defs/ObservabilityHealthResultV1"
      },
      {
        "$ref": "#/$defs/ObservabilityEventsResultV1"
      },
      {
        "$ref": "#/$defs/ObservabilityMetricsResultV1"
      },
      {
        "$ref": "#/$defs/ObservabilityErrorsResultV1"
      },
      {
        "$ref": "#/$defs/ObservabilityAlertsResultV1"
      },
      {
        "$ref": "#/$defs/DiagnosticsExportResultV1"
      },
      {
        "$ref": "#/$defs/ConfigDescribeResultV1"
      },
      {
        "$ref": "#/$defs/ConfigEffectiveResultV1"
      },
      {
        "$ref": "#/$defs/ConfigSetResultV1"
      },
      {
        "$ref": "#/$defs/ConfigResetResultV1"
      }
    ],
    "$defs": {
      "ConnectorListResultV1": {
        "title": "ConnectorListResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "connectors",
          "unreadable"
        ],
        "properties": {
          "connectors": {
            "type": "array",
            "minItems": 0,
            "maxItems": 200,
            "items": {
              "$ref": "./desktop-p06-domain.schema.json#/$defs/ConnectorViewV1"
            }
          },
          "unreadable": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          }
        }
      },
      "ConnectorGetResultV1": {
        "title": "ConnectorGetResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "connector",
          "operations",
          "invocations"
        ],
        "properties": {
          "connector": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/ConnectorViewV1"
          },
          "operations": {
            "type": "array",
            "minItems": 0,
            "maxItems": 32,
            "items": {
              "$ref": "./desktop-p06-domain.schema.json#/$defs/OperationViewV1"
            }
          },
          "invocations": {
            "type": "array",
            "minItems": 0,
            "maxItems": 20,
            "items": {
              "$ref": "./desktop-p06-domain.schema.json#/$defs/ConnectorInvocationV1"
            }
          }
        }
      },
      "ConnectorResultV1": {
        "title": "ConnectorResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "connector"
        ],
        "properties": {
          "connector": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/ConnectorViewV1"
          }
        }
      },
      "ConnectorRemoveResultV1": {
        "title": "ConnectorRemoveResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "connector_id",
          "removed",
          "tools_removed"
        ],
        "properties": {
          "connector_id": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/ConnectorId"
          },
          "removed": {
            "type": "boolean"
          },
          "tools_removed": {
            "type": "integer",
            "minimum": 0,
            "maximum": 32
          }
        }
      },
      "ConnectorTestResultV1": {
        "title": "ConnectorTestResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "connector_id",
          "health"
        ],
        "properties": {
          "connector_id": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/ConnectorId"
          },
          "probe_operation": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/OperationId"
          },
          "health": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/HealthRecordV1"
          },
          "reason_code": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/ReasonCode"
          }
        }
      },
      "ConnectorCredentialResultV1": {
        "title": "ConnectorCredentialResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "connector_id",
          "outcome",
          "auth"
        ],
        "properties": {
          "connector_id": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/ConnectorId"
          },
          "outcome": {
            "type": "string",
            "enum": [
              "STORED",
              "CLEARED",
              "PROMPT_CANCELLED",
              "STORE_UNAVAILABLE",
              "NOT_APPLICABLE",
              "NOTHING_TO_CLEAR"
            ]
          },
          "auth": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/ConnectorAuthStateV1"
          }
        }
      },
      "ConnectorOpenapiImportResultV1": {
        "title": "ConnectorOpenapiImportResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "import_id",
          "title",
          "operations",
          "rejected",
          "spec_digest",
          "status"
        ],
        "properties": {
          "import_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "title": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200
          },
          "suggested_base_url": {
            "type": "string",
            "minLength": 1,
            "maxLength": 300
          },
          "operations": {
            "type": "array",
            "minItems": 1,
            "maxItems": 32,
            "items": {
              "$ref": "./desktop-p06-domain.schema.json#/$defs/ConnectorOperationV1"
            }
          },
          "rejected": {
            "type": "array",
            "minItems": 0,
            "maxItems": 400,
            "items": {
              "$ref": "./desktop-p06-domain.schema.json#/$defs/RejectedOperationV1"
            }
          },
          "spec_digest": {
            "$ref": "./common/ids.schema.json#/$defs/Sha256Hex"
          },
          "status": {
            "const": "PROPOSED"
          }
        },
        "description": "Proposed operations and every rejected one with its reason. Document text is shown as data; nothing is enabled."
      },
      "UsageSummaryResultV1": {
        "title": "UsageSummaryResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "day",
          "today",
          "mission",
          "project",
          "by_provider",
          "by_model",
          "by_connector",
          "by_category",
          "show_estimated",
          "provenance_vocabulary",
          "note"
        ],
        "properties": {
          "day": {
            "type": "string",
            "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"
          },
          "today": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/UsageTotalsV1"
          },
          "mission": {
            "anyOf": [
              {
                "$ref": "./desktop-p06-domain.schema.json#/$defs/UsageTotalsV1"
              },
              {
                "type": "null"
              }
            ]
          },
          "project": {
            "anyOf": [
              {
                "$ref": "./desktop-p06-domain.schema.json#/$defs/UsageTotalsV1"
              },
              {
                "type": "null"
              }
            ]
          },
          "by_provider": {
            "type": "array",
            "minItems": 0,
            "maxItems": 200,
            "items": {
              "$ref": "./desktop-p06-domain.schema.json#/$defs/UsageTotalsV1"
            }
          },
          "by_model": {
            "type": "array",
            "minItems": 0,
            "maxItems": 500,
            "items": {
              "$ref": "./desktop-p06-domain.schema.json#/$defs/UsageTotalsV1"
            }
          },
          "by_connector": {
            "type": "array",
            "minItems": 0,
            "maxItems": 200,
            "items": {
              "$ref": "./desktop-p06-domain.schema.json#/$defs/UsageTotalsV1"
            }
          },
          "by_category": {
            "type": "array",
            "minItems": 0,
            "maxItems": 5,
            "items": {
              "$ref": "./desktop-p06-domain.schema.json#/$defs/UsageTotalsV1"
            }
          },
          "show_estimated": {
            "type": "boolean"
          },
          "provenance_vocabulary": {
            "type": "array",
            "minItems": 4,
            "maxItems": 4,
            "items": {
              "$ref": "./desktop-p06-domain.schema.json#/$defs/CostProvenance"
            }
          },
          "note": {
            "type": "string",
            "minLength": 1,
            "maxLength": 300
          }
        }
      },
      "UsageListResultV1": {
        "title": "UsageListResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "records"
        ],
        "properties": {
          "records": {
            "type": "array",
            "minItems": 0,
            "maxItems": 500,
            "items": {
              "$ref": "./desktop-p06-domain.schema.json#/$defs/UsageRecordV1"
            }
          }
        }
      },
      "BudgetListResultV1": {
        "title": "BudgetListResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "budgets"
        ],
        "properties": {
          "budgets": {
            "type": "array",
            "minItems": 0,
            "maxItems": 200,
            "items": {
              "title": "BudgetStatusV1",
              "type": "object",
              "additionalProperties": false,
              "required": [
                "budget",
                "window",
                "usage",
                "limit_display",
                "used_display"
              ],
              "properties": {
                "budget": {
                  "$ref": "./desktop-p06-domain.schema.json#/$defs/BudgetV1"
                },
                "window": {
                  "type": "string",
                  "enum": [
                    "LIFETIME",
                    "UTC_DAY"
                  ]
                },
                "usage": {
                  "$ref": "./desktop-p06-domain.schema.json#/$defs/BudgetUseV1"
                },
                "limit_display": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 40
                },
                "used_display": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 40
                }
              }
            }
          }
        }
      },
      "BudgetSetResultV1": {
        "title": "BudgetSetResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "budget",
          "limit_display"
        ],
        "properties": {
          "budget": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/BudgetV1"
          },
          "limit_display": {
            "type": "string",
            "minLength": 1,
            "maxLength": 40
          }
        }
      },
      "BudgetRemoveResultV1": {
        "title": "BudgetRemoveResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "budget_id",
          "removed"
        ],
        "properties": {
          "budget_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "removed": {
            "type": "boolean"
          }
        }
      },
      "PricingListResultV1": {
        "title": "PricingListResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "entries"
        ],
        "properties": {
          "entries": {
            "type": "array",
            "minItems": 0,
            "maxItems": 400,
            "items": {
              "$ref": "./desktop-p06-domain.schema.json#/$defs/PricingViewV1"
            }
          }
        }
      },
      "PricingSetResultV1": {
        "title": "PricingSetResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "entry"
        ],
        "properties": {
          "entry": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/PricingViewV1"
          }
        }
      },
      "PricingRemoveResultV1": {
        "title": "PricingRemoveResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "pricing_id",
          "removed"
        ],
        "properties": {
          "pricing_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "removed": {
            "type": "boolean"
          }
        }
      },
      "ObservabilityHealthResultV1": {
        "title": "ObservabilityHealthResultV1",
        "$ref": "./desktop-p06-domain.schema.json#/$defs/HealthOverviewV1"
      },
      "ObservabilityEventsResultV1": {
        "title": "ObservabilityEventsResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "events",
          "label"
        ],
        "properties": {
          "events": {
            "type": "array",
            "minItems": 0,
            "maxItems": 500,
            "items": {
              "$ref": "./desktop-p06-domain.schema.json#/$defs/ObsEventV1"
            }
          },
          "label": {
            "const": "STRUCTURED EVENTS — DIAGNOSTIC, NOT AUDIT"
          }
        }
      },
      "ObservabilityMetricsResultV1": {
        "title": "ObservabilityMetricsResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "metrics",
          "queue_depths"
        ],
        "properties": {
          "metrics": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/MetricsSnapshotV1"
          },
          "queue_depths": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/QueueDepthsV1"
          }
        }
      },
      "ObservabilityErrorsResultV1": {
        "title": "ObservabilityErrorsResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "errors_by_code",
          "overflow",
          "distinct_keys",
          "scope"
        ],
        "properties": {
          "errors_by_code": {
            "type": "array",
            "minItems": 0,
            "maxItems": 200,
            "items": {
              "$ref": "./desktop-p06-domain.schema.json#/$defs/ErrorGroupV1"
            }
          },
          "overflow": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "distinct_keys": {
            "type": "integer",
            "minimum": 0,
            "maximum": 200
          },
          "scope": {
            "const": "SINCE_START"
          }
        }
      },
      "ObservabilityAlertsResultV1": {
        "title": "ObservabilityAlertsResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "alerts"
        ],
        "properties": {
          "alerts": {
            "type": "array",
            "minItems": 0,
            "maxItems": 200,
            "items": {
              "$ref": "./desktop-p06-domain.schema.json#/$defs/AlertV1"
            }
          }
        }
      },
      "DiagnosticsExportResultV1": {
        "title": "DiagnosticsExportResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "file_name",
          "bytes",
          "level",
          "sections",
          "redactions",
          "document"
        ],
        "properties": {
          "file_name": {
            "anyOf": [
              {
                "type": "string",
                "pattern": "^polaris-diagnostics-[0-9]{14}\\.json$"
              },
              {
                "type": "null"
              }
            ]
          },
          "bytes": {
            "type": "integer",
            "minimum": 0,
            "maximum": 4194304
          },
          "level": {
            "type": "string",
            "enum": [
              "MINIMAL",
              "STANDARD",
              "DETAILED"
            ]
          },
          "sections": {
            "type": "array",
            "minItems": 3,
            "maxItems": 12,
            "items": {
              "type": "string",
              "minLength": 1,
              "maxLength": 40
            }
          },
          "redactions": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "document": {
            "title": "DiagnosticsDocumentV1",
            "type": "object",
            "additionalProperties": false,
            "required": [
              "schema",
              "generated_at",
              "level",
              "label",
              "versions",
              "health",
              "recent_reason_codes",
              "redactions"
            ],
            "properties": {
              "schema": {
                "const": "polaris.diagnostics.v1"
              },
              "generated_at": {
                "$ref": "./common/ids.schema.json#/$defs/Timestamp"
              },
              "level": {
                "type": "string",
                "enum": [
                  "MINIMAL",
                  "STANDARD",
                  "DETAILED"
                ]
              },
              "label": {
                "const": "LOCAL DIAGNOSTICS — REDACTED, NO SECRETS"
              },
              "versions": {
                "title": "DiagnosticsVersionsV1",
                "type": "object",
                "additionalProperties": false,
                "required": [
                  "app",
                  "ipc_protocol",
                  "contract",
                  "storage_schema",
                  "config_schema"
                ],
                "properties": {
                  "app": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 40
                  },
                  "ipc_protocol": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 10
                  },
                  "contract": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 10
                  },
                  "storage_schema": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 9007199254740991
                  },
                  "config_schema": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 9007199254740991
                  }
                }
              },
              "health": {
                "$ref": "./desktop-p06-domain.schema.json#/$defs/HealthOverviewV1"
              },
              "recent_reason_codes": {
                "type": "array",
                "minItems": 0,
                "maxItems": 500,
                "items": {
                  "title": "ReasonCountV1",
                  "type": "object",
                  "additionalProperties": false,
                  "required": [
                    "component",
                    "reason_code",
                    "count"
                  ],
                  "properties": {
                    "component": {
                      "$ref": "./desktop-p06-domain.schema.json#/$defs/Component"
                    },
                    "reason_code": {
                      "$ref": "./desktop-p06-domain.schema.json#/$defs/ReasonCode"
                    },
                    "count": {
                      "type": "integer",
                      "minimum": 0,
                      "maximum": 9007199254740991
                    }
                  }
                }
              },
              "config_summary": {
                "type": "array",
                "minItems": 0,
                "maxItems": 200,
                "items": {
                  "title": "ConfigSummaryItemV1",
                  "type": "object",
                  "additionalProperties": false,
                  "required": [
                    "key",
                    "value",
                    "source"
                  ],
                  "properties": {
                    "key": {
                      "$ref": "./desktop-p06-domain.schema.json#/$defs/SettingKey"
                    },
                    "value": {
                      "$ref": "./desktop-p06-domain.schema.json#/$defs/SettingValue"
                    },
                    "source": {
                      "$ref": "./desktop-p06-domain.schema.json#/$defs/ValueSource"
                    }
                  }
                }
              },
              "sensitive": {
                "type": "array",
                "minItems": 0,
                "maxItems": 200,
                "items": {
                  "$ref": "./desktop-p06-domain.schema.json#/$defs/SensitiveStatusV1"
                }
              },
              "metrics": {
                "$ref": "./desktop-p06-domain.schema.json#/$defs/MetricsSnapshotV1"
              },
              "queue_depths": {
                "$ref": "./desktop-p06-domain.schema.json#/$defs/QueueDepthsV1"
              },
              "alerts": {
                "type": "array",
                "minItems": 0,
                "maxItems": 200,
                "items": {
                  "$ref": "./desktop-p06-domain.schema.json#/$defs/AlertV1"
                }
              },
              "connectors": {
                "type": "array",
                "minItems": 0,
                "maxItems": 200,
                "items": {
                  "title": "DiagnosticsConnectorV1",
                  "type": "object",
                  "additionalProperties": false,
                  "required": [
                    "connector_id",
                    "provider",
                    "category",
                    "egress_class",
                    "enabled",
                    "operations"
                  ],
                  "properties": {
                    "connector_id": {
                      "$ref": "./desktop-p06-domain.schema.json#/$defs/ConnectorId"
                    },
                    "provider": {
                      "$ref": "./desktop-p06-domain.schema.json#/$defs/ConnectorProvider"
                    },
                    "category": {
                      "$ref": "./desktop-p06-domain.schema.json#/$defs/ConnectorCategory"
                    },
                    "egress_class": {
                      "$ref": "./desktop-p06-domain.schema.json#/$defs/EgressClass"
                    },
                    "enabled": {
                      "type": "boolean"
                    },
                    "operations": {
                      "type": "integer",
                      "minimum": 0,
                      "maximum": 32
                    }
                  }
                }
              },
              "performance": {
                "anyOf": [
                  {
                    "type": "object",
                    "additionalProperties": {
                      "type": "integer",
                      "minimum": 0
                    }
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "redactions": {
                "type": "integer",
                "minimum": 0,
                "maximum": 9007199254740991
              }
            }
          }
        },
        "description": "A bounded, redacted local diagnostics document. It carries codes, states and counts; no secret, header, prompt, page or connector payload."
      },
      "ConfigDescribeResultV1": {
        "title": "ConfigDescribeResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "sections",
          "status",
          "layers"
        ],
        "properties": {
          "sections": {
            "type": "array",
            "minItems": 19,
            "maxItems": 19,
            "items": {
              "title": "ConfigSectionV1",
              "type": "object",
              "additionalProperties": false,
              "required": [
                "section",
                "label_key",
                "settings"
              ],
              "properties": {
                "section": {
                  "$ref": "./desktop-p06-domain.schema.json#/$defs/ConfigSection"
                },
                "label_key": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 80
                },
                "settings": {
                  "type": "array",
                  "minItems": 1,
                  "maxItems": 32,
                  "items": {
                    "$ref": "./desktop-p06-domain.schema.json#/$defs/SettingDescriptorV1"
                  }
                }
              }
            }
          },
          "status": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/ConfigStatusV1"
          },
          "layers": {
            "type": "array",
            "minItems": 4,
            "maxItems": 4,
            "items": {
              "$ref": "./desktop-p06-domain.schema.json#/$defs/ConfigLayer"
            }
          }
        }
      },
      "ConfigEffectiveResultV1": {
        "title": "ConfigEffectiveResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "scope",
          "values",
          "status",
          "sensitive"
        ],
        "properties": {
          "scope": {
            "title": "ConfigScopeV1",
            "type": "object",
            "additionalProperties": false,
            "required": [
              "project_id",
              "mission_id"
            ],
            "properties": {
              "project_id": {
                "anyOf": [
                  {
                    "$ref": "./common/ids.schema.json#/$defs/Uuid"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "mission_id": {
                "anyOf": [
                  {
                    "$ref": "./common/ids.schema.json#/$defs/Uuid"
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            }
          },
          "values": {
            "type": "array",
            "minItems": 0,
            "maxItems": 200,
            "items": {
              "$ref": "./desktop-p06-domain.schema.json#/$defs/ResolvedValueV1"
            }
          },
          "status": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/ConfigStatusV1"
          },
          "sensitive": {
            "type": "array",
            "minItems": 0,
            "maxItems": 200,
            "items": {
              "$ref": "./desktop-p06-domain.schema.json#/$defs/SensitiveStatusV1"
            }
          }
        }
      },
      "ConfigSetResultV1": {
        "title": "ConfigSetResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "key",
          "layer",
          "value"
        ],
        "properties": {
          "key": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/SettingKey"
          },
          "layer": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/ConfigLayer"
          },
          "value": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/ResolvedValueV1"
          }
        }
      },
      "ConfigResetResultV1": {
        "title": "ConfigResetResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "key",
          "layer",
          "removed",
          "value"
        ],
        "properties": {
          "key": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/SettingKey"
          },
          "layer": {
            "$ref": "./desktop-p06-domain.schema.json#/$defs/ConfigLayer"
          },
          "removed": {
            "type": "boolean"
          },
          "value": {
            "anyOf": [
              {
                "$ref": "./desktop-p06-domain.schema.json#/$defs/ResolvedValueV1"
              },
              {
                "type": "null"
              }
            ]
          }
        }
      },
      "ConnectorPresetListResultV1": {
        "title": "ConnectorPresetListResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "presets"
        ],
        "properties": {
          "presets": {
            "type": "array",
            "minItems": 0,
            "maxItems": 64,
            "items": {
              "$ref": "./desktop-p06-domain.schema.json#/$defs/ConnectorPresetV1"
            }
          }
        }
      }
    }
  } as unknown as SchemaDocument,
  "desktop-p08-domain.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "DesktopPhase08Domain",
    "description": "Shared Phase-08 value shapes: mission workspaces, attachments, artifacts, sandboxed execution runs, schedules, OAuth connections, collaboration grants, publications, skill packages and integration settings. No shape carries a credential value, a token, an absolute path of the user's computer or raw untrusted content presented as instructions.",
    "$comment": "قيم مشتركة لعمليات Phase-08. لا قيمة سرّ ولا رمز ولا مسار مطلق من جهاز المستخدم.",
    "$defs": {
      "WorkspacePath": {
        "title": "WorkspacePath",
        "type": "string",
        "minLength": 1,
        "maxLength": 260,
        "pattern": "^[^\\\\:*?\"<>|\\u0000-\\u001f]+$",
        "description": "A path relative to one mission workspace, with forward slashes. Absolute paths, drive letters, backslashes and alternate data streams are unrepresentable; '..' and reserved names are refused by the host."
      },
      "FileName": {
        "title": "FileName",
        "type": "string",
        "minLength": 1,
        "maxLength": 255,
        "pattern": "^[^/\\\\:*?\"<>|\\u0000-\\u001f]+$"
      },
      "ArtifactType": {
        "title": "ArtifactType",
        "type": "string",
        "enum": [
          "DOCX",
          "PPTX",
          "XLSX",
          "PDF",
          "CSV",
          "HTML",
          "MARKDOWN",
          "TEXT",
          "JSON",
          "IMAGE",
          "WEB_SITE",
          "CODE_PROJECT"
        ]
      },
      "ModelId": {
        "title": "ModelId",
        "type": "string",
        "minLength": 1,
        "maxLength": 200,
        "pattern": "^[^\\s\\u0000-\\u001f]+$"
      },
      "SpecialistId": {
        "title": "SpecialistId",
        "type": "string",
        "minLength": 3,
        "maxLength": 120,
        "pattern": "^[a-z0-9-]+\\.[a-z0-9-]+$",
        "description": "A specialist from the built-in catalog, as <domain>.<slug>. Issued by the catalog, never by a model."
      },
      "AttachmentV1": {
        "title": "AttachmentV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "attachment_id",
          "mission_id",
          "file_name",
          "workspace_ref",
          "file_kind",
          "size_bytes",
          "sha256",
          "classification",
          "imported_at"
        ],
        "properties": {
          "attachment_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "mission_id": {
            "anyOf": [
              {
                "$ref": "./common/ids.schema.json#/$defs/Uuid"
              },
              {
                "type": "null"
              }
            ]
          },
          "file_name": {
            "$ref": "#/$defs/FileName"
          },
          "workspace_ref": {
            "type": "string",
            "maxLength": 300
          },
          "file_kind": {
            "type": "string",
            "maxLength": 20,
            "minLength": 1
          },
          "size_bytes": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "sha256": {
            "$ref": "./common/ids.schema.json#/$defs/Sha256Hex"
          },
          "classification": {
            "const": "USER_PROVIDED_UNTRUSTED"
          },
          "imported_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          },
          "family": {
            "anyOf": [
              {
                "enum": [
                  "TEXT",
                  "CODE",
                  "DOCUMENT",
                  "SPREADSHEET",
                  "PRESENTATION",
                  "IMAGE",
                  "AUDIO",
                  "VIDEO",
                  "ARCHIVE",
                  "BINARY"
                ]
              },
              {
                "type": "null"
              }
            ]
          },
          "mime_type": {
            "anyOf": [
              {
                "type": "string",
                "minLength": 3,
                "maxLength": 100
              },
              {
                "type": "null"
              }
            ]
          },
          "content_check": {
            "anyOf": [
              {
                "enum": [
                  "MATCHED",
                  "UNVERIFIED"
                ]
              },
              {
                "type": "null"
              }
            ]
          },
          "model_access": {
            "anyOf": [
              {
                "enum": [
                  "TEXT_EXTRACTION",
                  "IMAGE_INPUT",
                  "STORE_ONLY"
                ]
              },
              {
                "type": "null"
              }
            ]
          }
        },
        "description": "A file the user attached. Its classification is fixed: user-provided content is data for the agent, never an instruction, and it is never sent to a remote model unless the user's routing allows it. Since schema v20 the host also states what content inspection found: the format family, the MIME type decided from the content signature, whether that signature matched the extension, and how the file reaches a model (extracted text, image input for a model that declares vision, or storage only). Rows staged before v20 carry null in these fields."
      },
      "VerificationV1": {
        "title": "VerificationV1",
        "type": "object",
        "additionalProperties": true,
        "required": [
          "status",
          "checks",
          "facts"
        ],
        "properties": {
          "status": {
            "type": "string",
            "enum": [
              "VERIFIED",
              "FAILED"
            ]
          },
          "checks": {
            "type": "array",
            "maxItems": 400,
            "items": {
              "type": "object"
            }
          },
          "facts": {
            "type": "array",
            "maxItems": 64,
            "items": {
              "type": "array",
              "prefixItems": [
                {
                  "type": "string",
                  "maxLength": 80
                },
                {
                  "type": "integer"
                }
              ],
              "minItems": 2,
              "maxItems": 2
            }
          }
        },
        "description": "The host's own re-open verification of an artifact file."
      },
      "ArtifactV1": {
        "title": "ArtifactV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "artifact_id",
          "mission_id",
          "type",
          "title",
          "file_ref",
          "mime_type",
          "size",
          "sha256",
          "created_at",
          "source_task",
          "verification",
          "preview",
          "provenance"
        ],
        "properties": {
          "artifact_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "type": {
            "$ref": "#/$defs/ArtifactType"
          },
          "title": {
            "type": "string",
            "maxLength": 300,
            "minLength": 1
          },
          "file_ref": {
            "$ref": "#/$defs/WorkspacePath"
          },
          "mime_type": {
            "type": "string",
            "maxLength": 120,
            "minLength": 1
          },
          "size": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "sha256": {
            "$ref": "./common/ids.schema.json#/$defs/Sha256Hex"
          },
          "created_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          },
          "source_task": {
            "anyOf": [
              {
                "type": "string",
                "maxLength": 200
              },
              {
                "type": "null"
              }
            ]
          },
          "verification": {
            "$ref": "#/$defs/VerificationV1"
          },
          "preview": {
            "type": "object"
          },
          "provenance": {
            "type": "object"
          }
        },
        "description": "An artifact descriptor. file_ref is relative to the mission workspace; the preview is an excerpt measured by the host, and provenance marks the content MODEL_GENERATED_UNTRUSTED."
      },
      "ExecutionRunV1": {
        "title": "ExecutionRunV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "run_id",
          "task_id",
          "tool_id",
          "runtime",
          "command_preview",
          "status",
          "exit_code",
          "duration_ms",
          "output_truncated",
          "network",
          "processes_total",
          "survivors",
          "output_excerpt",
          "started_at",
          "finished_at"
        ],
        "properties": {
          "run_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "task_id": {
            "type": "string",
            "maxLength": 200
          },
          "tool_id": {
            "type": "string",
            "maxLength": 200
          },
          "runtime": {
            "type": "string",
            "enum": [
              "POWERSHELL",
              "PYTHON"
            ]
          },
          "command_preview": {
            "type": "string",
            "maxLength": 2000
          },
          "status": {
            "type": "string",
            "maxLength": 40,
            "minLength": 1
          },
          "exit_code": {
            "anyOf": [
              {
                "type": "integer"
              },
              {
                "type": "null"
              }
            ]
          },
          "duration_ms": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "output_truncated": {
            "type": "boolean"
          },
          "network": {
            "type": "boolean"
          },
          "processes_total": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "survivors": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "output_excerpt": {
            "type": "string",
            "maxLength": 20000
          },
          "started_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          },
          "finished_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          }
        },
        "description": "One sandboxed run, sanitised and bounded. survivors counts processes still alive when the job was closed; it is expected to be zero."
      },
      "MissionTemplateV1": {
        "title": "MissionTemplateV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "title",
          "objective"
        ],
        "properties": {
          "title": {
            "type": "string",
            "maxLength": 200,
            "minLength": 1
          },
          "objective": {
            "type": "string",
            "maxLength": 20000,
            "minLength": 1
          },
          "project_id": {
            "anyOf": [
              {
                "$ref": "./common/ids.schema.json#/$defs/Uuid"
              },
              {
                "type": "null"
              }
            ]
          },
          "model_id": {
            "anyOf": [
              {
                "$ref": "#/$defs/ModelId"
              },
              {
                "type": "null"
              }
            ]
          }
        }
      },
      "ScheduleSpecV1": {
        "title": "ScheduleSpecV1",
        "oneOf": [
          {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "kind",
              "at"
            ],
            "properties": {
              "kind": {
                "const": "ONCE"
              },
              "at": {
                "$ref": "./common/ids.schema.json#/$defs/Timestamp"
              }
            }
          },
          {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "kind",
              "minutes"
            ],
            "properties": {
              "kind": {
                "const": "INTERVAL"
              },
              "minutes": {
                "type": "integer",
                "minimum": 15,
                "maximum": 525600
              }
            }
          },
          {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "kind",
              "time"
            ],
            "properties": {
              "kind": {
                "const": "DAILY"
              },
              "time": {
                "type": "string",
                "pattern": "^([01][0-9]|2[0-3]):[0-5][0-9]$"
              }
            }
          },
          {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "kind",
              "days",
              "time"
            ],
            "properties": {
              "kind": {
                "const": "WEEKLY"
              },
              "days": {
                "type": "array",
                "minItems": 1,
                "maxItems": 7,
                "uniqueItems": true,
                "items": {
                  "type": "string",
                  "enum": [
                    "MON",
                    "TUE",
                    "WED",
                    "THU",
                    "FRI",
                    "SAT",
                    "SUN"
                  ]
                }
              },
              "time": {
                "type": "string",
                "pattern": "^([01][0-9]|2[0-3]):[0-5][0-9]$"
              }
            }
          },
          {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "kind",
              "days",
              "time"
            ],
            "description": "Days of the month 1..31 at one time. A month without a chosen day (31 in April) does not run on it.",
            "properties": {
              "kind": {
                "const": "MONTHLY"
              },
              "days": {
                "type": "array",
                "minItems": 1,
                "maxItems": 31,
                "uniqueItems": true,
                "items": {
                  "type": "integer",
                  "minimum": 1,
                  "maximum": 31
                }
              },
              "time": {
                "type": "string",
                "pattern": "^([01][0-9]|2[0-3]):[0-5][0-9]$"
              }
            }
          }
        ]
      },
      "TimeZone": {
        "title": "TimeZone",
        "type": "string",
        "pattern": "^UTC([+-](0[0-9]|1[0-4]):[0-5][0-9])?$",
        "description": "A fixed offset from UTC. Daylight-saving zones are represented by their current offset; the change is not followed (a declared limitation)."
      },
      "ApprovalPolicy": {
        "title": "ApprovalPolicy",
        "type": "string",
        "enum": [
          "WAIT_FOR_APPROVAL",
          "FAIL_ON_APPROVAL"
        ],
        "description": "What a scheduled mission does when a tool needs approval. Neither value grants the approval: the mission waits for the user, or it is cancelled and the reason recorded."
      },
      "ScheduleRunV1": {
        "title": "ScheduleRunV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "run_id",
          "schedule_id",
          "mission_id",
          "trigger_kind",
          "status",
          "detail",
          "triggered_at"
        ],
        "properties": {
          "run_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "schedule_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "mission_id": {
            "anyOf": [
              {
                "$ref": "./common/ids.schema.json#/$defs/Uuid"
              },
              {
                "type": "null"
              }
            ]
          },
          "trigger_kind": {
            "type": "string",
            "description": "PHASE-14: CATCH_UP = due while POLARIS was not running, run once on opening; RETRY = the one retry after a failed launch or a failed mission.",
            "enum": [
              "SCHEDULED",
              "RUN_NOW",
              "CATCH_UP",
              "RETRY"
            ]
          },
          "status": {
            "type": "string",
            "maxLength": 40,
            "minLength": 1
          },
          "detail": {
            "type": "string",
            "maxLength": 1000
          },
          "triggered_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          }
        }
      },
      "ScheduleV1": {
        "title": "ScheduleV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "schedule_id",
          "name",
          "mission_template",
          "timezone",
          "schedule",
          "enabled",
          "next_run",
          "last_run",
          "last_mission_id",
          "last_status",
          "budget",
          "approval_policy",
          "created_at",
          "updated_at",
          "end_at",
          "run_target"
        ],
        "properties": {
          "schedule_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "name": {
            "type": "string",
            "maxLength": 120,
            "minLength": 1
          },
          "mission_template": {
            "$ref": "#/$defs/MissionTemplateV1"
          },
          "timezone": {
            "$ref": "#/$defs/TimeZone"
          },
          "schedule": {
            "$ref": "#/$defs/ScheduleSpecV1"
          },
          "enabled": {
            "type": "boolean"
          },
          "next_run": {
            "anyOf": [
              {
                "$ref": "./common/ids.schema.json#/$defs/Timestamp"
              },
              {
                "type": "null"
              }
            ]
          },
          "last_run": {
            "anyOf": [
              {
                "$ref": "./common/ids.schema.json#/$defs/Timestamp"
              },
              {
                "type": "null"
              }
            ]
          },
          "last_mission_id": {
            "anyOf": [
              {
                "$ref": "./common/ids.schema.json#/$defs/Uuid"
              },
              {
                "type": "null"
              }
            ]
          },
          "last_status": {
            "anyOf": [
              {
                "type": "string",
                "maxLength": 40
              },
              {
                "type": "null"
              }
            ]
          },
          "budget": {
            "type": "object"
          },
          "approval_policy": {
            "$ref": "#/$defs/ApprovalPolicy"
          },
          "created_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          },
          "updated_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          },
          "recent_runs": {
            "type": "array",
            "maxItems": 10,
            "items": {
              "$ref": "#/$defs/ScheduleRunV1"
            }
          },
          "end_at": {
            "anyOf": [
              {
                "$ref": "./common/ids.schema.json#/$defs/Timestamp"
              },
              {
                "type": "null"
              }
            ],
            "description": "The last moment the schedule runs, or null."
          },
          "run_target": {
            "$ref": "#/$defs/RunTarget"
          }
        }
      },
      "OAuthConnectionV1": {
        "title": "OAuthConnectionV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "connection_id",
          "provider_id",
          "display_name",
          "client_id",
          "scopes",
          "status",
          "stored_in_vault",
          "expires_at",
          "created_at",
          "updated_at"
        ],
        "properties": {
          "connection_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "provider_id": {
            "type": "string",
            "maxLength": 64,
            "minLength": 1
          },
          "display_name": {
            "type": "string",
            "maxLength": 120,
            "minLength": 1
          },
          "client_id": {
            "type": "string",
            "maxLength": 200,
            "minLength": 1
          },
          "scopes": {
            "type": "string",
            "maxLength": 4000
          },
          "status": {
            "type": "string",
            "enum": [
              "PENDING",
              "CONNECTED",
              "FAILED",
              "REVOKED",
              "EXPIRED"
            ]
          },
          "stored_in_vault": {
            "type": "boolean"
          },
          "expires_at": {
            "anyOf": [
              {
                "$ref": "./common/ids.schema.json#/$defs/Timestamp"
              },
              {
                "type": "null"
              }
            ]
          },
          "created_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          },
          "updated_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          }
        },
        "description": "An OAuth connection as the renderer may see it: status and scopes. Neither the access token, the refresh token nor their vault reference crosses the boundary."
      },
      "ShareGrantV1": {
        "title": "ShareGrantV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "grant_id",
          "object_type",
          "object_id",
          "member",
          "role",
          "created_at"
        ],
        "properties": {
          "grant_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "object_type": {
            "type": "string",
            "enum": [
              "MISSION",
              "ARTIFACT",
              "WORKSPACE"
            ]
          },
          "object_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "member": {
            "type": "string",
            "maxLength": 200,
            "minLength": 1
          },
          "role": {
            "type": "string",
            "enum": [
              "OWNER",
              "EDITOR",
              "VIEWER"
            ]
          },
          "created_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          }
        }
      },
      "PublicationV1": {
        "title": "PublicationV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "publication_id",
          "artifact_id",
          "publisher",
          "status",
          "target",
          "created_at",
          "updated_at"
        ],
        "properties": {
          "publication_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "artifact_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "publisher": {
            "type": "string",
            "maxLength": 64,
            "minLength": 1
          },
          "status": {
            "type": "string",
            "enum": [
              "AWAITING_APPROVAL",
              "PUBLISHED",
              "DENIED",
              "FAILED"
            ]
          },
          "target": {
            "type": "string",
            "maxLength": 400
          },
          "created_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          },
          "updated_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          }
        }
      },
      "SkillPackageV1": {
        "title": "SkillPackageV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "package_id",
          "name",
          "version",
          "author",
          "manifest_sha256",
          "signature_state",
          "source",
          "trust_state",
          "rejection",
          "imported_at",
          "grants_authority"
        ],
        "properties": {
          "package_id": {
            "type": "string",
            "maxLength": 120
          },
          "name": {
            "type": "string",
            "maxLength": 120
          },
          "version": {
            "type": "string",
            "maxLength": 40
          },
          "author": {
            "type": "string",
            "maxLength": 200
          },
          "manifest_sha256": {
            "$ref": "./common/ids.schema.json#/$defs/Sha256Hex"
          },
          "signature_state": {
            "type": "string",
            "maxLength": 40,
            "minLength": 1
          },
          "source": {
            "type": "string",
            "maxLength": 200
          },
          "trust_state": {
            "type": "string",
            "maxLength": 40,
            "minLength": 1
          },
          "rejection": {
            "anyOf": [
              {
                "type": "string",
                "maxLength": 500
              },
              {
                "type": "null"
              }
            ]
          },
          "imported_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          },
          "grants_authority": {
            "const": false
          }
        },
        "description": "An imported skill package. grants_authority is always false: a package describes a skill, it grants no capability."
      },
      "IntegrationSettingKey": {
        "title": "IntegrationSettingKey",
        "type": "string",
        "enum": [
          "voice.transcription_endpoint",
          "voice.transcription_model",
          "workspace.export_folder_label",
          "browser.engine_enabled",
          "web.search_endpoint",
          "profile.nickname",
          "profile.profession",
          "profile.about",
          "profile.instructions",
          "web.search_provider",
          "notifications.enabled",
          "notifications.sound"
        ],
        "description": "A Phase-08 setting. profile.* is what the user wrote about themselves on the Customize page; the agent reads it as the user's own words in every task."
      },
      "IntegrationSettingsV1": {
        "title": "IntegrationSettingsV1",
        "type": "object",
        "propertyNames": {
          "$ref": "#/$defs/IntegrationSettingKey"
        },
        "additionalProperties": {
          "anyOf": [
            {
              "type": "string",
              "maxLength": 3000
            },
            {
              "type": "boolean"
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "RuntimeStateV1": {
        "title": "RuntimeStateV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "available",
          "detail"
        ],
        "properties": {
          "available": {
            "type": "boolean"
          },
          "detail": {
            "type": "string",
            "maxLength": 400
          }
        }
      },
      "RunTarget": {
        "title": "RunTarget",
        "type": "string",
        "enum": [
          "SEPARATE_TASK",
          "SAME_TASK"
        ],
        "description": "SEPARATE_TASK: each run is its own task. SAME_TASK: each run is the next turn in the previous run's task; the first run starts it."
      }
    }
  } as unknown as SchemaDocument,
  "desktop-p08-request.v1.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "DesktopPhase08RequestPayloadV1",
    "description": "The closed set of request payloads the Phase-08 operations accept. No payload runs a command, runs Python, drives the browser, writes into a mission workspace, reads an OAuth token or sends a message: those have one caller, the trusted mission runtime, and one path, the tool gateway.",
    "$comment": "لا تنفيذ من العارض: لا أمر ولا Python ولا تصفّح ولا كتابة في مساحة مهمّة ولا رمز OAuth.",
    "anyOf": [
      {
        "$ref": "#/$defs/WorkspaceListRequestV1"
      },
      {
        "$ref": "#/$defs/WorkspacePreviewRequestV1"
      },
      {
        "$ref": "#/$defs/WorkspaceExportRequestV1"
      },
      {
        "$ref": "#/$defs/AttachmentStageRequestV1"
      },
      {
        "$ref": "#/$defs/AttachmentDiscardRequestV1"
      },
      {
        "$ref": "#/$defs/AttachmentArtifactStageRequestV1"
      },
      {
        "$ref": "#/$defs/AttachmentListRequestV1"
      },
      {
        "$ref": "#/$defs/AttachmentBindRequestV1"
      },
      {
        "$ref": "#/$defs/ArtifactListRequestV1"
      },
      {
        "$ref": "#/$defs/ArtifactGetRequestV1"
      },
      {
        "$ref": "#/$defs/ExecutionStatusRequestV1"
      },
      {
        "$ref": "#/$defs/ExecutionRunsRequestV1"
      },
      {
        "$ref": "#/$defs/ExecutionRuntimePrepareRequestV1"
      },
      {
        "$ref": "#/$defs/MissionModelSetRequestV1"
      },
      {
        "$ref": "#/$defs/ScheduleListRequestV1"
      },
      {
        "$ref": "#/$defs/ScheduleSaveRequestV1"
      },
      {
        "$ref": "#/$defs/ScheduleEnableRequestV1"
      },
      {
        "$ref": "#/$defs/ScheduleDeleteRequestV1"
      },
      {
        "$ref": "#/$defs/ScheduleRunNowRequestV1"
      },
      {
        "$ref": "#/$defs/OauthListRequestV1"
      },
      {
        "$ref": "#/$defs/OauthConnectRequestV1"
      },
      {
        "$ref": "#/$defs/OauthDisconnectRequestV1"
      },
      {
        "$ref": "#/$defs/VoiceTranscribeRequestV1"
      },
      {
        "$ref": "#/$defs/ShareListRequestV1"
      },
      {
        "$ref": "#/$defs/ShareSetRequestV1"
      },
      {
        "$ref": "#/$defs/PublishListRequestV1"
      },
      {
        "$ref": "#/$defs/PublishProposeRequestV1"
      },
      {
        "$ref": "#/$defs/PublishDecideRequestV1"
      },
      {
        "$ref": "#/$defs/SkillPackageListRequestV1"
      },
      {
        "$ref": "#/$defs/SkillPackageImportRequestV1"
      },
      {
        "$ref": "#/$defs/DeviceExportRequestV1"
      },
      {
        "$ref": "#/$defs/DeviceImportRequestV1"
      },
      {
        "$ref": "#/$defs/IntegrationSettingsSetRequestV1"
      },
      {
        "$ref": "#/$defs/ConversationBeginRequestV1"
      },
      {
        "$ref": "#/$defs/ConversationContinueRequestV1"
      },
      {
        "$ref": "#/$defs/ConversationGetRequestV1"
      },
      {
        "$ref": "#/$defs/ConversationIndexRequestV1"
      },
      {
        "$ref": "#/$defs/AgentCatalogRequestV1"
      },
      {
        "$ref": "#/$defs/MissionSpecialistSetRequestV1"
      },
      {
        "$ref": "#/$defs/ConversationUpdateRequestV1"
      },
      {
        "$ref": "#/$defs/ConversationDeleteRequestV1"
      },
      {
        "$ref": "#/$defs/ProjectDeleteRequestV1"
      },
      {
        "$ref": "#/$defs/MemoryRememberRequestV1"
      },
      {
        "$ref": "#/$defs/ConversationSearchRequestV1"
      },
      {
        "$ref": "#/$defs/ProviderCatalogRequestV1"
      },
      {
        "$ref": "#/$defs/ProviderCredentialPutRequestV1"
      },
      {
        "$ref": "#/$defs/ProviderCustomSaveRequestV1"
      },
      {
        "$ref": "#/$defs/ProviderCustomDeleteRequestV1"
      },
      {
        "$ref": "#/$defs/MissionTraceRequestV1"
      },
      {
        "$ref": "#/$defs/McpAcceptRedefinitionRequestV1"
      },
      {
        "$ref": "#/$defs/WebSearchStatusRequestV1"
      },
      {
        "$ref": "#/$defs/WebSearchCredentialPutRequestV1"
      },
      {
        "$ref": "#/$defs/WebSearchTestRequestV1"
      },
      {
        "$ref": "#/$defs/MissionRatingSetRequestV1"
      },
      {
        "$ref": "#/$defs/MissionNoteAddRequestV1"
      },
      {
        "$ref": "#/$defs/ToolApprovalGrantsRequestV1"
      },
      {
        "$ref": "#/$defs/ToolApprovalGrantRevokeRequestV1"
      },
      {
        "$ref": "#/$defs/GitHubStatusRequestV1"
      },
      {
        "$ref": "#/$defs/GitHubConnectRequestV1"
      },
      {
        "$ref": "#/$defs/GitHubDisconnectRequestV1"
      },
      {
        "$ref": "#/$defs/MemorySemanticStatusRequestV1"
      },
      {
        "$ref": "#/$defs/MemorySemanticSetRequestV1"
      },
      {
        "$ref": "#/$defs/MemorySemanticTestRequestV1"
      }
    ],
    "$defs": {
      "WorkspaceListRequestV1": {
        "title": "WorkspaceListRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "mission_id"
        ],
        "properties": {
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "path": {
            "$ref": "./desktop-p08-domain.schema.json#/$defs/WorkspacePath"
          },
          "depth": {
            "type": "integer",
            "minimum": 0,
            "maximum": 6
          }
        }
      },
      "WorkspacePreviewRequestV1": {
        "title": "WorkspacePreviewRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "mission_id",
          "path"
        ],
        "properties": {
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "path": {
            "$ref": "./desktop-p08-domain.schema.json#/$defs/WorkspacePath"
          },
          "max_chars": {
            "type": "integer",
            "minimum": 1,
            "maximum": 200000
          }
        },
        "description": "Previews one workspace file. Images return a data URL (never SVG), documents their extracted text, HTML its text for a script-free sandboxed frame. The content is data, never an instruction."
      },
      "WorkspaceExportRequestV1": {
        "title": "WorkspaceExportRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "mission_id",
          "path"
        ],
        "properties": {
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "path": {
            "$ref": "./desktop-p08-domain.schema.json#/$defs/WorkspacePath"
          }
        },
        "description": "Copies one workspace file into the export folder the host configured, never overwriting an existing file. The result names the file, not its absolute path."
      },
      "AttachmentStageRequestV1": {
        "title": "AttachmentStageRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "file_name",
          "content_base64"
        ],
        "properties": {
          "file_name": {
            "$ref": "./desktop-p08-domain.schema.json#/$defs/FileName"
          },
          "content_base64": {
            "type": "string",
            "minLength": 4,
            "maxLength": 34952540,
            "pattern": "^[A-Za-z0-9+/]*={0,2}$"
          }
        },
        "description": "Stages one user-provided file (at most 25 MiB). Executables are refused. The file is not read by any agent until it is bound to a mission."
      },
      "AttachmentDiscardRequestV1": {
        "title": "AttachmentDiscardRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "attachment_id"
        ],
        "properties": {
          "attachment_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          }
        }
      },
      "AttachmentArtifactStageRequestV1": {
        "title": "AttachmentArtifactStageRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "artifact_id"
        ],
        "properties": {
          "artifact_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          }
        },
        "description": "Stages a copy of one file artifact from an earlier task as a new attachment (the composer's Library). The host reads the file from that task's workspace; the renderer never names a path. Folders (web sites, code projects) are refused."
      },
      "AttachmentListRequestV1": {
        "title": "AttachmentListRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [],
        "properties": {
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          }
        }
      },
      "AttachmentBindRequestV1": {
        "title": "AttachmentBindRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "mission_id",
          "attachment_ids"
        ],
        "properties": {
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "attachment_ids": {
            "type": "array",
            "minItems": 1,
            "maxItems": 20,
            "uniqueItems": true,
            "items": {
              "$ref": "./common/ids.schema.json#/$defs/Uuid"
            }
          }
        }
      },
      "ArtifactListRequestV1": {
        "title": "ArtifactListRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [],
        "properties": {
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          }
        }
      },
      "ArtifactGetRequestV1": {
        "title": "ArtifactGetRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "artifact_id"
        ],
        "properties": {
          "artifact_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          }
        }
      },
      "ExecutionStatusRequestV1": {
        "title": "ExecutionStatusRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [],
        "properties": {},
        "description": "The execution environment as measured now: the isolation this host binds, whether each runtime can run, and the integration settings. No path crosses."
      },
      "ExecutionRunsRequestV1": {
        "title": "ExecutionRunsRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "mission_id"
        ],
        "properties": {
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          }
        }
      },
      "ExecutionRuntimePrepareRequestV1": {
        "title": "ExecutionRuntimePrepareRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "runtime"
        ],
        "properties": {
          "runtime": {
            "const": "PYTHON"
          }
        },
        "description": "Copies the base Python found on this computer into POLARIS's own data folder, once, so the sandbox can be granted read access without changing any permission on the user's files."
      },
      "MissionModelSetRequestV1": {
        "title": "MissionModelSetRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "mission_id",
          "model_id"
        ],
        "properties": {
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "model_id": {
            "anyOf": [
              {
                "$ref": "./desktop-p08-domain.schema.json#/$defs/ModelId"
              },
              {
                "type": "null"
              }
            ]
          }
        },
        "description": "Chooses the model for one mission. The choice is routed manually through Phase-02 routing and its egress gate, so a disabled model or a remote provider its policy forbids still fails."
      },
      "ScheduleListRequestV1": {
        "title": "ScheduleListRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [],
        "properties": {}
      },
      "ScheduleSaveRequestV1": {
        "title": "ScheduleSaveRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "name",
          "mission_template",
          "timezone",
          "schedule",
          "approval_policy"
        ],
        "properties": {
          "schedule_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "name": {
            "type": "string",
            "maxLength": 120,
            "minLength": 1
          },
          "mission_template": {
            "$ref": "./desktop-p08-domain.schema.json#/$defs/MissionTemplateV1"
          },
          "timezone": {
            "$ref": "./desktop-p08-domain.schema.json#/$defs/TimeZone"
          },
          "schedule": {
            "$ref": "./desktop-p08-domain.schema.json#/$defs/ScheduleSpecV1"
          },
          "enabled": {
            "type": "boolean"
          },
          "budget": {
            "type": "object",
            "maxProperties": 16
          },
          "approval_policy": {
            "$ref": "./desktop-p08-domain.schema.json#/$defs/ApprovalPolicy"
          },
          "end_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          },
          "run_target": {
            "$ref": "./desktop-p08-domain.schema.json#/$defs/RunTarget"
          }
        },
        "description": "Creates a schedule, or updates the one named by schedule_id."
      },
      "ScheduleEnableRequestV1": {
        "title": "ScheduleEnableRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "schedule_id",
          "enabled"
        ],
        "properties": {
          "schedule_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "enabled": {
            "type": "boolean"
          }
        }
      },
      "ScheduleDeleteRequestV1": {
        "title": "ScheduleDeleteRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "schedule_id"
        ],
        "properties": {
          "schedule_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          }
        }
      },
      "ScheduleRunNowRequestV1": {
        "title": "ScheduleRunNowRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "schedule_id"
        ],
        "properties": {
          "schedule_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          }
        },
        "description": "Starts one run of a schedule now, in the background. The run is an ordinary mission: approvals it needs are not granted by the schedule."
      },
      "OauthListRequestV1": {
        "title": "OauthListRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [],
        "properties": {}
      },
      "OauthConnectRequestV1": {
        "title": "OauthConnectRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "provider_id",
          "client_id"
        ],
        "properties": {
          "provider_id": {
            "type": "string",
            "maxLength": 64,
            "minLength": 1
          },
          "client_id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200,
            "pattern": "^\\S+$"
          },
          "scopes": {
            "type": "array",
            "maxItems": 32,
            "items": {
              "type": "string",
              "minLength": 1,
              "maxLength": 200,
              "pattern": "^\\S+$"
            }
          }
        },
        "description": "Starts an OAuth 2.0 authorization-code flow with PKCE (S256) and a loopback redirect. The client id is the user's own registration; the host never scrapes a sign-in page and never returns a token."
      },
      "OauthDisconnectRequestV1": {
        "title": "OauthDisconnectRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "connection_id"
        ],
        "properties": {
          "connection_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          }
        }
      },
      "VoiceTranscribeRequestV1": {
        "title": "VoiceTranscribeRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "audio_base64"
        ],
        "properties": {
          "audio_base64": {
            "type": "string",
            "minLength": 4,
            "maxLength": 34952540,
            "pattern": "^[A-Za-z0-9+/]*={0,2}$"
          },
          "language": {
            "type": "string",
            "pattern": "^[A-Za-z-]{2,8}$"
          }
        },
        "description": "Transcribes one recording on a transcription server on this computer (loopback only). The audio is not stored."
      },
      "ShareListRequestV1": {
        "title": "ShareListRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "object_type",
          "object_id"
        ],
        "properties": {
          "object_type": {
            "type": "string",
            "enum": [
              "MISSION",
              "ARTIFACT",
              "WORKSPACE"
            ]
          },
          "object_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          }
        }
      },
      "ShareSetRequestV1": {
        "title": "ShareSetRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "object_type",
          "object_id",
          "member",
          "role"
        ],
        "properties": {
          "object_type": {
            "type": "string",
            "enum": [
              "MISSION",
              "ARTIFACT",
              "WORKSPACE"
            ]
          },
          "object_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "member": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200
          },
          "role": {
            "anyOf": [
              {
                "type": "string",
                "enum": [
                  "OWNER",
                  "EDITOR",
                  "VIEWER"
                ]
              },
              {
                "type": "null"
              }
            ]
          }
        },
        "description": "Sets or removes (role null) one member's role. The grant is local data; it sends nothing to anyone."
      },
      "PublishListRequestV1": {
        "title": "PublishListRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [],
        "properties": {}
      },
      "PublishProposeRequestV1": {
        "title": "PublishProposeRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "artifact_id",
          "publisher_id"
        ],
        "properties": {
          "artifact_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "publisher_id": {
            "type": "string",
            "maxLength": 64,
            "minLength": 1
          }
        },
        "description": "Proposes a verified artifact for publication. Nothing is published until publish.decide grants it."
      },
      "PublishDecideRequestV1": {
        "title": "PublishDecideRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "publication_id",
          "decision"
        ],
        "properties": {
          "publication_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "decision": {
            "type": "string",
            "enum": [
              "GRANT",
              "DENY"
            ]
          }
        },
        "description": "The user's decision on one proposal. A grant publishes once, after re-checking the artifact's digest."
      },
      "SkillPackageListRequestV1": {
        "title": "SkillPackageListRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [],
        "properties": {}
      },
      "SkillPackageImportRequestV1": {
        "title": "SkillPackageImportRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "manifest_json"
        ],
        "properties": {
          "manifest_json": {
            "type": "string",
            "minLength": 2,
            "maxLength": 262144
          }
        },
        "description": "Imports a skill package manifest. An imported package is UNTRUSTED and grants no authority whatever its signature state."
      },
      "DeviceExportRequestV1": {
        "title": "DeviceExportRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "mission_id"
        ],
        "properties": {
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          }
        },
        "description": "Packs one mission workspace into a verified bundle in the export folder. This is portability, not synchronisation."
      },
      "DeviceImportRequestV1": {
        "title": "DeviceImportRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "bundle_base64"
        ],
        "properties": {
          "bundle_base64": {
            "type": "string",
            "minLength": 4,
            "maxLength": 89478488,
            "pattern": "^[A-Za-z0-9+/]*={0,2}$"
          }
        },
        "description": "Imports a workspace bundle into a new import folder after checking every digest. It touches no mission and no database row."
      },
      "IntegrationSettingsSetRequestV1": {
        "title": "IntegrationSettingsSetRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "key",
          "value"
        ],
        "properties": {
          "key": {
            "$ref": "./desktop-p08-domain.schema.json#/$defs/IntegrationSettingKey"
          },
          "value": {
            "anyOf": [
              {
                "type": "string",
                "maxLength": 3000
              },
              {
                "type": "boolean"
              },
              {
                "type": "null"
              }
            ]
          }
        },
        "description": "Writes one integration setting. A transcription endpoint that is not on this computer is refused."
      },
      "ConversationBeginRequestV1": {
        "title": "ConversationBeginRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "mission_id"
        ],
        "properties": {
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          }
        },
        "description": "Declares a mission the renderer has just created as the first turn of a conversation, so the mission ends with a reply addressed to the user in the user's language."
      },
      "ConversationContinueRequestV1": {
        "title": "ConversationContinueRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "mission_id",
          "message"
        ],
        "properties": {
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "message": {
            "type": "string",
            "minLength": 1,
            "maxLength": 6000
          }
        },
        "description": "Adds the user's next message to the conversation of this mission and creates the mission for that turn, inheriting its project, model and workspace. It does not start it: mission.start does."
      },
      "ConversationGetRequestV1": {
        "title": "ConversationGetRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "mission_id"
        ],
        "properties": {
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          }
        }
      },
      "ConversationIndexRequestV1": {
        "title": "ConversationIndexRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [],
        "properties": {}
      },
      "AgentCatalogRequestV1": {
        "title": "AgentCatalogRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [],
        "properties": {}
      },
      "MissionSpecialistSetRequestV1": {
        "title": "MissionSpecialistSetRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "mission_id",
          "specialist_id"
        ],
        "properties": {
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "specialist_id": {
            "anyOf": [
              {
                "$ref": "./desktop-p08-domain.schema.json#/$defs/SpecialistId"
              },
              {
                "type": "null"
              }
            ]
          }
        },
        "description": "Pins one catalog specialist to a mission (and its follow-ups), or clears the pin with null. The specialist shapes instructions only; it grants no tool or permission."
      },
      "ConversationUpdateRequestV1": {
        "title": "ConversationUpdateRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "thread_id"
        ],
        "minProperties": 2,
        "properties": {
          "thread_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "title": {
            "type": "string",
            "minLength": 1,
            "maxLength": 120
          },
          "pinned": {
            "type": "boolean"
          },
          "favorite": {
            "type": "boolean"
          },
          "archived": {
            "type": "boolean"
          },
          "project_id": {
            "anyOf": [
              {
                "$ref": "./common/ids.schema.json#/$defs/Uuid"
              },
              {
                "type": "null"
              }
            ]
          }
        },
        "description": "What the task menu changes about a conversation, applied to every turn of it: a title the user chose (the planner no longer replaces it), pinning, favourites, archiving (hidden from the list, not deleted), and moving it into a project or out of one (null). An absent field is unchanged; at least one is present."
      },
      "ConversationDeleteRequestV1": {
        "title": "ConversationDeleteRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "thread_id"
        ],
        "properties": {
          "thread_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          }
        },
        "description": "Deletes a conversation for good: its turns, narration, missions, evidence, outputs, mission memory and workspace folder. Refused while a turn is working or waiting for a decision. Accounting rows are detached, not deleted; the audit chain records the deletion without any title or text."
      },
      "ProjectDeleteRequestV1": {
        "title": "ProjectDeleteRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "project_id"
        ],
        "properties": {
          "project_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          }
        },
        "description": "Deletes a project: its instructions, context sources, project memory and project settings. Its conversations are not deleted; they leave the project. Refused while a mission in it is working."
      },
      "MemoryRememberRequestV1": {
        "title": "MemoryRememberRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "text",
          "scope"
        ],
        "properties": {
          "text": {
            "type": "string",
            "minLength": 1,
            "maxLength": 2000
          },
          "scope": {
            "enum": [
              "USER",
              "PROJECT"
            ]
          },
          "project_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "topic": {
            "type": "string",
            "minLength": 1,
            "maxLength": 80,
            "pattern": "^[^\\u0000-\\u001f\\u007f]*$",
            "description": "The subject as the user names it (agent plan D2). A newer statement by the user on the same named subject replaces their older one, which stays visible as superseded."
          }
        },
        "description": "Remember this: text the user wrote, about themselves (USER) or about a project (PROJECT, project_id required). It passes the same memory policy as any candidate (bounds, secret filter, type and scope, duplicates) and is stored USER_DERIVED and UNVERIFIED. It is not memory.write: no free type, no system scope, no trust upgrade. mission_id names the conversation it was said in."
      },
      "ConversationSearchRequestV1": {
        "title": "ConversationSearchRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [],
        "properties": {
          "query": {
            "type": "string",
            "maxLength": 200
          },
          "limit": {
            "type": "integer",
            "minimum": 1,
            "maximum": 50
          }
        },
        "description": "Searches conversation titles, the user messages and POLARIS replies, ignoring Arabic spelling variants (hamza forms, ta marbuta, alef maqsura, diacritics). An empty query lists the latest conversations. Read only."
      },
      "ProviderCatalogRequestV1": {
        "title": "ProviderCatalogRequestV1",
        "type": "object",
        "additionalProperties": false,
        "properties": {},
        "description": "Reads the provider catalog for the connect dialog (ADR-037): every built-in, catalogued and custom provider, without reading a credential."
      },
      "ProviderCredentialPutRequestV1": {
        "title": "ProviderCredentialPutRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "provider_id",
          "api_key"
        ],
        "properties": {
          "provider_id": {
            "$ref": "./desktop-p02-domain.schema.json#/$defs/ProviderId"
          },
          "api_key": {
            "type": "string",
            "minLength": 1,
            "maxLength": 4096,
            "pattern": "^[^\\u0000-\\u001f\\u007f]*$",
            "description": "The key the user typed in the in-app connect field. The one payload field allowed to carry a credential (ADR-037, owner decision 2026-10-06). The host stores it in the operating system's credential store and never returns it."
          }
        },
        "description": "Stores an API key typed in the app's connect dialog. The only renderer payload that carries a credential, and only in this field."
      },
      "ProviderCustomSaveRequestV1": {
        "title": "ProviderCustomSaveRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "provider_id",
          "display_name",
          "base_url"
        ],
        "properties": {
          "provider_id": {
            "$ref": "./desktop-p02-domain.schema.json#/$defs/ProviderId"
          },
          "display_name": {
            "type": "string",
            "minLength": 1,
            "maxLength": 64,
            "pattern": "^[^\\u0000-\\u001f\\u007f]*$"
          },
          "base_url": {
            "type": "string",
            "minLength": 8,
            "maxLength": 256,
            "pattern": "^https?://[^\\s?#@]+$",
            "description": "A public https address, or http on this computer only. The host resolves it and refuses a private address."
          },
          "models": {
            "type": "array",
            "maxItems": 64,
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "model_id"
              ],
              "properties": {
                "model_id": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 200,
                  "pattern": "^[^\\s\\u0000-\\u001f\\u007f]+$"
                },
                "display_name": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 120,
                  "pattern": "^[^\\u0000-\\u001f\\u007f]*$"
                }
              }
            }
          }
        },
        "description": "Creates or edits a user-defined OpenAI-compatible provider. Carries no credential: the key travels in provider.credential.put."
      },
      "ProviderCustomDeleteRequestV1": {
        "title": "ProviderCustomDeleteRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "provider_id"
        ],
        "properties": {
          "provider_id": {
            "$ref": "./desktop-p02-domain.schema.json#/$defs/ProviderId"
          }
        },
        "description": "Deletes a custom provider, its models and its stored key. A built-in or catalogued provider is disconnected, not deleted."
      },
      "MissionTraceRequestV1": {
        "title": "MissionTraceRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "mission_id"
        ],
        "properties": {
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "include_otlp": {
            "type": "boolean",
            "description": "ADR-041: return the spans as OTLP/JSON as well. Nothing is sent anywhere."
          },
          "after": {
            "type": "integer",
            "minimum": 0,
            "description": "PHASE-10 (CP-10-1): how many spans, in start order, to skip before this page."
          },
          "limit": {
            "type": "integer",
            "minimum": 1,
            "maximum": 1000,
            "description": "PHASE-10 (CP-10-1): the page size; 500 when absent."
          }
        }
      },
      "McpAcceptRedefinitionRequestV1": {
        "title": "McpAcceptRedefinitionRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "tool_id"
        ],
        "properties": {
          "tool_id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 300
          }
        }
      },
      "WebSearchStatusRequestV1": {
        "title": "WebSearchStatusRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [],
        "properties": {},
        "description": "Reads which web search provider is chosen and whether it is ready. No side effect, no network."
      },
      "WebSearchCredentialPutRequestV1": {
        "title": "WebSearchCredentialPutRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "provider",
          "api_key"
        ],
        "properties": {
          "provider": {
            "const": "BRAVE"
          },
          "api_key": {
            "anyOf": [
              {
                "type": "string",
                "minLength": 8,
                "maxLength": 400
              },
              {
                "type": "null"
              }
            ]
          }
        },
        "description": "Stores the user's API key for the web search provider in the operating system credential store, or deletes it when api_key is null. The key never comes back."
      },
      "WebSearchTestRequestV1": {
        "title": "WebSearchTestRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [],
        "properties": {},
        "description": "Sends one real search with a fixed neutral query to the chosen provider and reports the outcome. Network effect, initiated by the user."
      },
      "MissionRatingSetRequestV1": {
        "title": "MissionRatingSetRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "mission_id",
          "rating"
        ],
        "properties": {
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "rating": {
            "type": "integer",
            "minimum": 1,
            "maximum": 5
          }
        },
        "description": "Stores the user's rating of a finished turn on this computer. It is not sent anywhere and does not train a model."
      },
      "MissionNoteAddRequestV1": {
        "title": "MissionNoteAddRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "mission_id",
          "text"
        ],
        "properties": {
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "text": {
            "type": "string",
            "minLength": 1,
            "maxLength": 2000
          }
        },
        "description": "Queues a message for a running mission. The agent reads it as a user message at the next safe point between steps; it never enters the system instruction and grants nothing."
      },
      "ToolApprovalGrantsRequestV1": {
        "title": "ToolApprovalGrantsRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "mission_id"
        ],
        "properties": {
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          }
        },
        "description": "Lists the active mission-scoped approval grants of a mission."
      },
      "ToolApprovalGrantRevokeRequestV1": {
        "title": "ToolApprovalGrantRevokeRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "mission_id"
        ],
        "properties": {
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "grant_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          }
        },
        "description": "Revokes one mission-scoped grant, or all of the mission's grants when grant_id is absent."
      },
      "GitHubStatusRequestV1": {
        "title": "GitHubStatusRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [],
        "properties": {},
        "description": "Reads whether a GitHub token is stored and what GitHub said about it when it was last checked. No network."
      },
      "GitHubConnectRequestV1": {
        "title": "GitHubConnectRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "token"
        ],
        "properties": {
          "token": {
            "type": "string",
            "minLength": 20,
            "maxLength": 255
          }
        },
        "description": "Checks a GitHub token the user created (a fine-grained token with read-only access is recommended) against the GitHub API and stores it in the operating system credential store. The token never comes back."
      },
      "MemorySemanticStatusRequestV1": {
        "title": "MemorySemanticStatusRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [],
        "properties": {},
        "description": "PHASE-12: the semantic memory setting and whether the host ranks memory by similarity now."
      },
      "MemorySemanticSetRequestV1": {
        "title": "MemorySemanticSetRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "enabled"
        ],
        "properties": {
          "enabled": {
            "type": "boolean"
          },
          "endpoint": {
            "type": "string",
            "maxLength": 300,
            "pattern": "^https?://(127\\.0\\.0\\.1|localhost|\\[::1\\])(:[0-9]{1,5})?(/[^\\s?#]*)?$",
            "description": "An embedding server on this computer only; the host checks it again."
          },
          "model": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200,
            "pattern": "^[^\\u0000-\\u001f\\u007f]+$"
          },
          "min_similarity": {
            "type": "number",
            "minimum": 0.3,
            "maximum": 0.95
          },
          "query_prefix": {
            "type": "string",
            "maxLength": 40,
            "pattern": "^[^\\u0000-\\u001f\\u007f]*$"
          },
          "document_prefix": {
            "type": "string",
            "maxLength": 40,
            "pattern": "^[^\\u0000-\\u001f\\u007f]*$"
          }
        },
        "description": "PHASE-12: choose an embedding server on this computer and its model, or turn semantic ranking off. Memory text is never sent anywhere else by this setting."
      },
      "MemorySemanticTestRequestV1": {
        "title": "MemorySemanticTestRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [],
        "properties": {},
        "description": "Embeds one fixed sentence with the saved server; no memory is read or sent."
      },
      "GitHubDisconnectRequestV1": {
        "title": "GitHubDisconnectRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [],
        "properties": {},
        "description": "Deletes the stored GitHub token. Revoking it on GitHub stays the user's action."
      }
    }
  } as unknown as SchemaDocument,
  "desktop-p08-result.v1.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "DesktopPhase08ResultPayloadV1",
    "description": "The closed set of result payloads the Phase-08 operations return. No result carries a credential value, a token or its vault reference, or an absolute path of the user's computer.",
    "$comment": "ما يعبر: معرّفات وحالات ومسارات نسبية داخل المساحة ومقتطفات محدودة. لا سرّ ولا مسار مطلق.",
    "anyOf": [
      {
        "$ref": "#/$defs/WorkspaceListResultV1"
      },
      {
        "$ref": "#/$defs/WorkspacePreviewResultV1"
      },
      {
        "$ref": "#/$defs/WorkspaceExportResultV1"
      },
      {
        "$ref": "#/$defs/AttachmentStageResultV1"
      },
      {
        "$ref": "#/$defs/AttachmentDiscardResultV1"
      },
      {
        "$ref": "#/$defs/AttachmentListResultV1"
      },
      {
        "$ref": "#/$defs/AttachmentBindResultV1"
      },
      {
        "$ref": "#/$defs/ArtifactListResultV1"
      },
      {
        "$ref": "#/$defs/ArtifactGetResultV1"
      },
      {
        "$ref": "#/$defs/ExecutionStatusResultV1"
      },
      {
        "$ref": "#/$defs/ExecutionRunsResultV1"
      },
      {
        "$ref": "#/$defs/ExecutionRuntimePrepareResultV1"
      },
      {
        "$ref": "#/$defs/MissionModelSetResultV1"
      },
      {
        "$ref": "#/$defs/ScheduleListResultV1"
      },
      {
        "$ref": "#/$defs/ScheduleSaveResultV1"
      },
      {
        "$ref": "#/$defs/ScheduleEnableResultV1"
      },
      {
        "$ref": "#/$defs/ScheduleDeleteResultV1"
      },
      {
        "$ref": "#/$defs/ScheduleRunNowResultV1"
      },
      {
        "$ref": "#/$defs/OauthListResultV1"
      },
      {
        "$ref": "#/$defs/OauthConnectResultV1"
      },
      {
        "$ref": "#/$defs/OauthDisconnectResultV1"
      },
      {
        "$ref": "#/$defs/VoiceTranscribeResultV1"
      },
      {
        "$ref": "#/$defs/ShareListResultV1"
      },
      {
        "$ref": "#/$defs/ShareSetResultV1"
      },
      {
        "$ref": "#/$defs/PublishListResultV1"
      },
      {
        "$ref": "#/$defs/PublishProposeResultV1"
      },
      {
        "$ref": "#/$defs/PublishDecideResultV1"
      },
      {
        "$ref": "#/$defs/SkillPackageListResultV1"
      },
      {
        "$ref": "#/$defs/SkillPackageImportResultV1"
      },
      {
        "$ref": "#/$defs/DeviceExportResultV1"
      },
      {
        "$ref": "#/$defs/DeviceImportResultV1"
      },
      {
        "$ref": "#/$defs/IntegrationSettingsSetResultV1"
      },
      {
        "$ref": "#/$defs/ConversationBeginResultV1"
      },
      {
        "$ref": "#/$defs/ConversationContinueResultV1"
      },
      {
        "$ref": "#/$defs/ConversationGetResultV1"
      },
      {
        "$ref": "#/$defs/ConversationIndexResultV1"
      },
      {
        "$ref": "#/$defs/AgentCatalogResultV1"
      },
      {
        "$ref": "#/$defs/MissionSpecialistSetResultV1"
      },
      {
        "$ref": "#/$defs/ConversationUpdateResultV1"
      },
      {
        "$ref": "#/$defs/ConversationDeleteResultV1"
      },
      {
        "$ref": "#/$defs/ProjectDeleteResultV1"
      },
      {
        "$ref": "#/$defs/MemoryRememberResultV1"
      },
      {
        "$ref": "#/$defs/ConversationSearchResultV1"
      },
      {
        "$ref": "#/$defs/ProviderCatalogResultV1"
      },
      {
        "$ref": "#/$defs/ProviderCustomDeleteResultV1"
      },
      {
        "$ref": "#/$defs/MissionTraceResultV1"
      },
      {
        "$ref": "#/$defs/McpAcceptRedefinitionResultV1"
      },
      {
        "$ref": "#/$defs/WebSearchStatusResultV1"
      },
      {
        "$ref": "#/$defs/WebSearchTestResultV1"
      },
      {
        "$ref": "#/$defs/MemorySemanticStatusResultV1"
      },
      {
        "$ref": "#/$defs/MemorySemanticTestResultV1"
      },
      {
        "$ref": "#/$defs/MissionRatingResultV1"
      },
      {
        "$ref": "#/$defs/MissionNoteResultV1"
      },
      {
        "$ref": "#/$defs/ToolApprovalGrantsResultV1"
      },
      {
        "$ref": "#/$defs/ToolApprovalGrantRevokeResultV1"
      },
      {
        "$ref": "#/$defs/GitHubStatusResultV1"
      }
    ],
    "$defs": {
      "WebSearchStatusResultV1": {
        "title": "WebSearchStatusResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "provider",
          "ready",
          "searxng_endpoint_configured",
          "brave_key_configured",
          "secure_store_available"
        ],
        "properties": {
          "provider": {
            "enum": [
              "NONE",
              "SEARXNG",
              "BRAVE"
            ]
          },
          "ready": {
            "type": "boolean"
          },
          "searxng_endpoint_configured": {
            "type": "boolean"
          },
          "brave_key_configured": {
            "type": "boolean"
          },
          "secure_store_available": {
            "type": "boolean"
          }
        },
        "description": "The chosen web search provider and whether it has what it needs. A key is reported as present or absent, never shown."
      },
      "MemorySemanticStatusResultV1": {
        "title": "MemorySemanticStatusResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "enabled",
          "endpoint",
          "model",
          "min_similarity",
          "query_prefix",
          "document_prefix",
          "active",
          "retrievals",
          "failures"
        ],
        "properties": {
          "enabled": {
            "type": "boolean"
          },
          "endpoint": {
            "anyOf": [
              {
                "type": "string",
                "maxLength": 300
              },
              {
                "type": "null"
              }
            ]
          },
          "model": {
            "anyOf": [
              {
                "type": "string",
                "maxLength": 200
              },
              {
                "type": "null"
              }
            ]
          },
          "min_similarity": {
            "type": "number",
            "minimum": 0,
            "maximum": 1
          },
          "query_prefix": {
            "type": "string",
            "maxLength": 40
          },
          "document_prefix": {
            "type": "string",
            "maxLength": 40
          },
          "active": {
            "type": "boolean",
            "description": "The host ranks memory by similarity now; a saved setting alone is not enough."
          },
          "retrievals": {
            "type": "integer",
            "minimum": 0,
            "description": "Retrievals ranked with similarity since this host started."
          },
          "failures": {
            "type": "integer",
            "minimum": 0,
            "description": "Retrievals that fell back to lexical ranking because embedding failed."
          }
        }
      },
      "MemorySemanticTestResultV1": {
        "title": "MemorySemanticTestResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "outcome",
          "dimensions",
          "duration_ms"
        ],
        "properties": {
          "outcome": {
            "enum": [
              "OK",
              "NOT_CONFIGURED",
              "UNREACHABLE",
              "MALFORMED_RESPONSE",
              "REFUSED"
            ]
          },
          "dimensions": {
            "anyOf": [
              {
                "type": "integer",
                "minimum": 1,
                "maximum": 8192
              },
              {
                "type": "null"
              }
            ]
          },
          "duration_ms": {
            "type": "integer",
            "minimum": 0
          }
        }
      },
      "WebSearchTestResultV1": {
        "title": "WebSearchTestResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "provider",
          "outcome",
          "results",
          "duration_ms"
        ],
        "properties": {
          "provider": {
            "enum": [
              "NONE",
              "SEARXNG",
              "BRAVE"
            ]
          },
          "outcome": {
            "enum": [
              "OK",
              "NOT_CONFIGURED",
              "AUTH_FAILED",
              "RATE_LIMITED",
              "UNREACHABLE",
              "REFUSED",
              "MALFORMED",
              "TIMEOUT"
            ]
          },
          "results": {
            "type": "integer",
            "minimum": 0,
            "maximum": 20
          },
          "duration_ms": {
            "type": "integer",
            "minimum": 0
          }
        },
        "description": "The outcome of one real test search, measured on the host."
      },
      "MissionRatingResultV1": {
        "title": "MissionRatingResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "mission_id",
          "rating",
          "rated_at"
        ],
        "properties": {
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "rating": {
            "type": "integer",
            "minimum": 1,
            "maximum": 5
          },
          "rated_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          }
        },
        "description": "The stored rating."
      },
      "TurnNoteV1": {
        "title": "TurnNoteV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "note_id",
          "mission_id",
          "seq",
          "text",
          "state",
          "created_at"
        ],
        "properties": {
          "note_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "seq": {
            "type": "integer",
            "minimum": 1,
            "maximum": 10000
          },
          "text": {
            "type": "string",
            "minLength": 1,
            "maxLength": 2000
          },
          "state": {
            "enum": [
              "QUEUED",
              "DELIVERED",
              "NOT_DELIVERED"
            ]
          },
          "created_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          },
          "delivered_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          }
        },
        "description": "A message the user wrote while the mission ran. DELIVERED means the agent received it as a user message at delivered_at; NOT_DELIVERED means the mission ended first."
      },
      "MissionNoteResultV1": {
        "title": "MissionNoteResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "note"
        ],
        "properties": {
          "note": {
            "$ref": "#/$defs/TurnNoteV1"
          }
        },
        "description": "The queued note."
      },
      "MissionGrantV1": {
        "title": "MissionGrantV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "grant_id",
          "tool_id",
          "resource",
          "effects",
          "created_at",
          "expires_at"
        ],
        "properties": {
          "grant_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "tool_id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200
          },
          "resource": {
            "type": "string",
            "minLength": 1,
            "maxLength": 400
          },
          "effects": {
            "type": "array",
            "minItems": 1,
            "maxItems": 8,
            "items": {
              "type": "string",
              "maxLength": 40
            }
          },
          "created_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          },
          "expires_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          }
        },
        "description": "One mission-scoped approval: this tool, this resource, these effects, in this mission, until expires_at. The gateway still evaluates policy on every call."
      },
      "ToolApprovalGrantsResultV1": {
        "title": "ToolApprovalGrantsResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "mission_id",
          "grants"
        ],
        "properties": {
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "grants": {
            "type": "array",
            "maxItems": 64,
            "items": {
              "$ref": "#/$defs/MissionGrantV1"
            }
          }
        },
        "description": "The mission's active grants."
      },
      "ToolApprovalGrantRevokeResultV1": {
        "title": "ToolApprovalGrantRevokeResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "mission_id",
          "revoked"
        ],
        "properties": {
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "revoked": {
            "type": "integer",
            "minimum": 0
          }
        },
        "description": "How many grants were revoked now."
      },
      "GitHubStatusResultV1": {
        "title": "GitHubStatusResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "connected",
          "secure_store_available"
        ],
        "properties": {
          "connected": {
            "type": "boolean"
          },
          "secure_store_available": {
            "type": "boolean"
          },
          "login": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          },
          "grant_kind": {
            "enum": [
              "FINE_GRAINED",
              "CLASSIC",
              "UNKNOWN"
            ]
          },
          "scopes": {
            "type": "array",
            "maxItems": 32,
            "items": {
              "type": "string",
              "maxLength": 64
            }
          },
          "checked_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          }
        },
        "description": "Whether a GitHub token is stored, and the account and scopes GitHub reported when it was checked. Never the token."
      },
      "WorkspaceListResultV1": {
        "title": "WorkspaceListResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "mission_id",
          "entries",
          "used_bytes"
        ],
        "properties": {
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "entries": {
            "type": "array",
            "maxItems": 2000,
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "path",
                "is_dir",
                "size_bytes"
              ],
              "properties": {
                "path": {
                  "$ref": "./desktop-p08-domain.schema.json#/$defs/WorkspacePath"
                },
                "is_dir": {
                  "type": "boolean"
                },
                "size_bytes": {
                  "type": "integer",
                  "minimum": 0,
                  "maximum": 9007199254740991
                }
              }
            }
          },
          "used_bytes": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          }
        }
      },
      "WorkspacePreviewResultV1": {
        "title": "WorkspacePreviewResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "path",
          "kind",
          "mime_type",
          "size_bytes",
          "truncated"
        ],
        "properties": {
          "path": {
            "$ref": "./desktop-p08-domain.schema.json#/$defs/WorkspacePath"
          },
          "kind": {
            "type": "string",
            "enum": [
              "TEXT",
              "DOCUMENT",
              "HTML",
              "IMAGE",
              "BINARY"
            ]
          },
          "mime_type": {
            "type": "string",
            "maxLength": 120,
            "minLength": 1
          },
          "size_bytes": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "text": {
            "type": "string",
            "maxLength": 1000000
          },
          "data_url": {
            "type": "string",
            "maxLength": 8400000,
            "pattern": "^data:image/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]*={0,2}$"
          },
          "truncated": {
            "type": "boolean"
          }
        }
      },
      "WorkspaceExportResultV1": {
        "title": "WorkspaceExportResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "file_label",
          "size_bytes",
          "sha256"
        ],
        "properties": {
          "file_label": {
            "$ref": "./desktop-p08-domain.schema.json#/$defs/FileName"
          },
          "size_bytes": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "sha256": {
            "$ref": "./common/ids.schema.json#/$defs/Sha256Hex"
          }
        }
      },
      "AttachmentStageResultV1": {
        "title": "AttachmentStageResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "attachment"
        ],
        "properties": {
          "attachment": {
            "$ref": "./desktop-p08-domain.schema.json#/$defs/AttachmentV1"
          }
        }
      },
      "AttachmentDiscardResultV1": {
        "title": "AttachmentDiscardResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "attachment_id",
          "discarded"
        ],
        "properties": {
          "attachment_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "discarded": {
            "type": "boolean"
          }
        }
      },
      "AttachmentListResultV1": {
        "title": "AttachmentListResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "attachments"
        ],
        "properties": {
          "attachments": {
            "type": "array",
            "maxItems": 500,
            "items": {
              "$ref": "./desktop-p08-domain.schema.json#/$defs/AttachmentV1"
            }
          }
        }
      },
      "AttachmentBindResultV1": {
        "title": "AttachmentBindResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "mission_id",
          "attachments"
        ],
        "properties": {
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "attachments": {
            "type": "array",
            "maxItems": 20,
            "items": {
              "$ref": "./desktop-p08-domain.schema.json#/$defs/AttachmentV1"
            }
          }
        }
      },
      "ArtifactListResultV1": {
        "title": "ArtifactListResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "artifacts"
        ],
        "properties": {
          "artifacts": {
            "type": "array",
            "maxItems": 200,
            "items": {
              "$ref": "./desktop-p08-domain.schema.json#/$defs/ArtifactV1"
            }
          }
        }
      },
      "ArtifactGetResultV1": {
        "title": "ArtifactGetResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "artifact",
          "publications"
        ],
        "properties": {
          "artifact": {
            "$ref": "./desktop-p08-domain.schema.json#/$defs/ArtifactV1"
          },
          "publications": {
            "type": "array",
            "maxItems": 200,
            "items": {
              "$ref": "./desktop-p08-domain.schema.json#/$defs/PublicationV1"
            }
          }
        }
      },
      "ExecutionStatusResultV1": {
        "title": "ExecutionStatusResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "isolation",
          "powershell",
          "python",
          "python_version",
          "python_source_found",
          "pdf_font_available",
          "export_folder_configured",
          "voice_configured",
          "device_id",
          "setting_keys",
          "settings"
        ],
        "properties": {
          "isolation": {
            "type": "string",
            "maxLength": 80,
            "minLength": 1
          },
          "powershell": {
            "$ref": "./desktop-p08-domain.schema.json#/$defs/RuntimeStateV1"
          },
          "python": {
            "$ref": "./desktop-p08-domain.schema.json#/$defs/RuntimeStateV1"
          },
          "python_version": {
            "anyOf": [
              {
                "type": "string",
                "maxLength": 40
              },
              {
                "type": "null"
              }
            ]
          },
          "python_source_found": {
            "type": "boolean"
          },
          "pdf_font_available": {
            "type": "boolean"
          },
          "export_folder_configured": {
            "type": "boolean"
          },
          "voice_configured": {
            "type": "boolean"
          },
          "device_id": {
            "type": "string",
            "maxLength": 36
          },
          "setting_keys": {
            "type": "array",
            "maxItems": 16,
            "items": {
              "$ref": "./desktop-p08-domain.schema.json#/$defs/IntegrationSettingKey"
            }
          },
          "settings": {
            "$ref": "./desktop-p08-domain.schema.json#/$defs/IntegrationSettingsV1"
          }
        }
      },
      "ExecutionRunsResultV1": {
        "title": "ExecutionRunsResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "mission_id",
          "runs"
        ],
        "properties": {
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "runs": {
            "type": "array",
            "maxItems": 100,
            "items": {
              "$ref": "./desktop-p08-domain.schema.json#/$defs/ExecutionRunV1"
            }
          }
        }
      },
      "ExecutionRuntimePrepareResultV1": {
        "title": "ExecutionRuntimePrepareResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "runtime",
          "available",
          "version",
          "files",
          "bytes",
          "reused"
        ],
        "properties": {
          "runtime": {
            "const": "PYTHON"
          },
          "available": {
            "type": "boolean"
          },
          "version": {
            "type": "string",
            "maxLength": 40
          },
          "files": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "bytes": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "reused": {
            "type": "boolean"
          }
        }
      },
      "MissionModelSetResultV1": {
        "title": "MissionModelSetResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "mission_id",
          "model_id"
        ],
        "properties": {
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "model_id": {
            "anyOf": [
              {
                "$ref": "./desktop-p08-domain.schema.json#/$defs/ModelId"
              },
              {
                "type": "null"
              }
            ]
          }
        }
      },
      "ScheduleListResultV1": {
        "title": "ScheduleListResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "schedules"
        ],
        "properties": {
          "schedules": {
            "type": "array",
            "maxItems": 200,
            "items": {
              "$ref": "./desktop-p08-domain.schema.json#/$defs/ScheduleV1"
            }
          }
        }
      },
      "ScheduleSaveResultV1": {
        "title": "ScheduleSaveResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "schedule"
        ],
        "properties": {
          "schedule": {
            "$ref": "./desktop-p08-domain.schema.json#/$defs/ScheduleV1"
          }
        }
      },
      "ScheduleEnableResultV1": {
        "title": "ScheduleEnableResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "schedule"
        ],
        "properties": {
          "schedule": {
            "$ref": "./desktop-p08-domain.schema.json#/$defs/ScheduleV1"
          }
        }
      },
      "ScheduleDeleteResultV1": {
        "title": "ScheduleDeleteResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "schedule_id",
          "deleted"
        ],
        "properties": {
          "schedule_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "deleted": {
            "type": "boolean"
          }
        }
      },
      "ScheduleRunNowResultV1": {
        "title": "ScheduleRunNowResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "schedule_id",
          "started"
        ],
        "properties": {
          "schedule_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "started": {
            "type": "boolean"
          }
        }
      },
      "OauthListResultV1": {
        "title": "OauthListResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "providers",
          "connections"
        ],
        "properties": {
          "providers": {
            "type": "array",
            "maxItems": 32,
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "provider_id",
                "display_name",
                "default_scopes"
              ],
              "properties": {
                "provider_id": {
                  "type": "string",
                  "maxLength": 64,
                  "minLength": 1
                },
                "display_name": {
                  "type": "string",
                  "maxLength": 120,
                  "minLength": 1
                },
                "default_scopes": {
                  "type": "array",
                  "maxItems": 32,
                  "items": {
                    "type": "string",
                    "maxLength": 200
                  }
                }
              }
            }
          },
          "connections": {
            "type": "array",
            "maxItems": 100,
            "items": {
              "$ref": "./desktop-p08-domain.schema.json#/$defs/OAuthConnectionV1"
            }
          }
        }
      },
      "OauthConnectResultV1": {
        "title": "OauthConnectResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "connection_id",
          "consent_url",
          "redirect_uri",
          "opened_in_browser"
        ],
        "properties": {
          "connection_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "consent_url": {
            "type": "string",
            "maxLength": 4000,
            "pattern": "^https://"
          },
          "redirect_uri": {
            "type": "string",
            "maxLength": 200,
            "pattern": "^http://127\\.0\\.0\\.1:[0-9]{1,5}/"
          },
          "opened_in_browser": {
            "type": "boolean"
          }
        }
      },
      "OauthDisconnectResultV1": {
        "title": "OauthDisconnectResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "connection_id",
          "revoked"
        ],
        "properties": {
          "connection_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "revoked": {
            "type": "boolean"
          }
        }
      },
      "VoiceTranscribeResultV1": {
        "title": "VoiceTranscribeResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "text",
          "seconds"
        ],
        "properties": {
          "text": {
            "type": "string",
            "maxLength": 20000
          },
          "seconds": {
            "type": "integer",
            "minimum": 0,
            "maximum": 600
          }
        }
      },
      "ShareListResultV1": {
        "title": "ShareListResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "grants"
        ],
        "properties": {
          "grants": {
            "type": "array",
            "maxItems": 200,
            "items": {
              "$ref": "./desktop-p08-domain.schema.json#/$defs/ShareGrantV1"
            }
          }
        }
      },
      "ShareSetResultV1": {
        "title": "ShareSetResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "grants"
        ],
        "properties": {
          "grants": {
            "type": "array",
            "maxItems": 200,
            "items": {
              "$ref": "./desktop-p08-domain.schema.json#/$defs/ShareGrantV1"
            }
          }
        }
      },
      "PublishListResultV1": {
        "title": "PublishListResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "publishers",
          "publications"
        ],
        "properties": {
          "publishers": {
            "type": "array",
            "maxItems": 16,
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "publisher_id",
                "leaves_device"
              ],
              "properties": {
                "publisher_id": {
                  "type": "string",
                  "maxLength": 64,
                  "minLength": 1
                },
                "leaves_device": {
                  "type": "boolean"
                }
              }
            }
          },
          "publications": {
            "type": "array",
            "maxItems": 200,
            "items": {
              "$ref": "./desktop-p08-domain.schema.json#/$defs/PublicationV1"
            }
          }
        }
      },
      "PublishProposeResultV1": {
        "title": "PublishProposeResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "publication"
        ],
        "properties": {
          "publication": {
            "$ref": "./desktop-p08-domain.schema.json#/$defs/PublicationV1"
          }
        }
      },
      "PublishDecideResultV1": {
        "title": "PublishDecideResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "publication"
        ],
        "properties": {
          "publication": {
            "$ref": "./desktop-p08-domain.schema.json#/$defs/PublicationV1"
          }
        }
      },
      "SkillPackageListResultV1": {
        "title": "SkillPackageListResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "packages"
        ],
        "properties": {
          "packages": {
            "type": "array",
            "maxItems": 500,
            "items": {
              "$ref": "./desktop-p08-domain.schema.json#/$defs/SkillPackageV1"
            }
          }
        }
      },
      "SkillPackageImportResultV1": {
        "title": "SkillPackageImportResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "package"
        ],
        "properties": {
          "package": {
            "$ref": "./desktop-p08-domain.schema.json#/$defs/SkillPackageV1"
          }
        }
      },
      "DeviceExportResultV1": {
        "title": "DeviceExportResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "file_label",
          "size_bytes",
          "sha256"
        ],
        "properties": {
          "file_label": {
            "$ref": "./desktop-p08-domain.schema.json#/$defs/FileName"
          },
          "size_bytes": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "sha256": {
            "$ref": "./common/ids.schema.json#/$defs/Sha256Hex"
          }
        }
      },
      "DeviceImportResultV1": {
        "title": "DeviceImportResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "import_folder",
          "files",
          "source_device_id",
          "source_mission_id"
        ],
        "properties": {
          "import_folder": {
            "type": "string",
            "maxLength": 80,
            "minLength": 1
          },
          "files": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "source_device_id": {
            "anyOf": [
              {
                "type": "string",
                "maxLength": 36
              },
              {
                "type": "null"
              }
            ]
          },
          "source_mission_id": {
            "anyOf": [
              {
                "type": "string",
                "maxLength": 36
              },
              {
                "type": "null"
              }
            ]
          }
        }
      },
      "IntegrationSettingsSetResultV1": {
        "title": "IntegrationSettingsSetResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "settings"
        ],
        "properties": {
          "settings": {
            "$ref": "./desktop-p08-domain.schema.json#/$defs/IntegrationSettingsV1"
          }
        }
      },
      "ConversationTurnV1": {
        "title": "ConversationTurnV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "mission_id",
          "seq",
          "message",
          "created_at",
          "state",
          "completion_proof_status"
        ],
        "properties": {
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "seq": {
            "type": "integer",
            "minimum": 0,
            "maximum": 10000
          },
          "message": {
            "type": "string",
            "minLength": 1,
            "maxLength": 20000
          },
          "created_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          },
          "state": {
            "$ref": "./desktop-p03-domain.schema.json#/$defs/MissionState"
          },
          "completion_proof_status": {
            "$ref": "./desktop-p03-domain.schema.json#/$defs/CompletionProofStatus"
          },
          "started_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          },
          "completed_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          },
          "answer": {
            "type": "string",
            "maxLength": 4000
          },
          "failure_reason": {
            "type": "string",
            "maxLength": 4000
          },
          "model_id": {
            "$ref": "./desktop-p08-domain.schema.json#/$defs/ModelId"
          },
          "specialist_id": {
            "$ref": "./desktop-p08-domain.schema.json#/$defs/SpecialistId"
          },
          "rating": {
            "type": "integer",
            "minimum": 1,
            "maximum": 5
          },
          "notes": {
            "type": "array",
            "maxItems": 200,
            "items": {
              "$ref": "#/$defs/TurnNoteV1"
            }
          }
        },
        "description": "One user message and the mission that answered it. The message is shown as the user wrote it; answer is model output, displayed as data."
      },
      "ConversationEntryV1": {
        "title": "ConversationEntryV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "entry_id",
          "mission_id",
          "kind",
          "text",
          "created_at"
        ],
        "properties": {
          "entry_id": {
            "type": "integer",
            "minimum": 1
          },
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "kind": {
            "enum": [
              "PLAN",
              "STEP",
              "ACTION",
              "NOTE",
              "SUGGESTION"
            ]
          },
          "text": {
            "type": "string",
            "minLength": 1,
            "maxLength": 2000
          },
          "detail": {
            "type": "string",
            "maxLength": 200
          },
          "created_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          }
        },
        "description": "One line of a mission's live narration: the agent's words to the user (PLAN, NOTE), a step title (STEP), or a tool call with the status the gateway measured (ACTION)."
      },
      "ConversationV1": {
        "title": "ConversationV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "thread_id",
          "title",
          "turns",
          "entries",
          "thinking"
        ],
        "properties": {
          "thread_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "title": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200
          },
          "project_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "turns": {
            "type": "array",
            "maxItems": 10001,
            "items": {
              "$ref": "#/$defs/ConversationTurnV1"
            }
          },
          "entries": {
            "type": "array",
            "maxItems": 4000000,
            "items": {
              "$ref": "#/$defs/ConversationEntryV1"
            }
          },
          "thinking": {
            "type": "boolean"
          }
        }
      },
      "ConversationBeginResultV1": {
        "title": "ConversationBeginResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "thread_id",
          "mission_id"
        ],
        "properties": {
          "thread_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          }
        }
      },
      "ConversationContinueResultV1": {
        "title": "ConversationContinueResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "thread_id",
          "mission_id",
          "seq"
        ],
        "properties": {
          "thread_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "seq": {
            "type": "integer",
            "minimum": 1,
            "maximum": 10000
          }
        }
      },
      "ConversationGetResultV1": {
        "title": "ConversationGetResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "conversation"
        ],
        "properties": {
          "conversation": {
            "$ref": "#/$defs/ConversationV1"
          }
        }
      },
      "ConversationIndexResultV1": {
        "title": "ConversationIndexResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "follow_ups"
        ],
        "properties": {
          "follow_ups": {
            "type": "array",
            "maxItems": 100000,
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "mission_id",
                "thread_id"
              ],
              "properties": {
                "mission_id": {
                  "$ref": "./common/ids.schema.json#/$defs/Uuid"
                },
                "thread_id": {
                  "$ref": "./common/ids.schema.json#/$defs/Uuid"
                }
              }
            }
          },
          "threads": {
            "type": "array",
            "maxItems": 100000,
            "items": {
              "$ref": "#/$defs/ConversationThreadV1"
            }
          }
        },
        "description": "Follow-up turns and the conversation each belongs to (the missions a task list shows inside their conversation instead of on their own), and the conversations the task menu changed (ADR-031)."
      },
      "SpecialistDomainV1": {
        "title": "SpecialistDomainV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "domain_id",
          "name_ar",
          "name_en",
          "count"
        ],
        "properties": {
          "domain_id": {
            "type": "string",
            "pattern": "^[a-z0-9-]{1,48}$"
          },
          "name_ar": {
            "type": "string",
            "minLength": 1,
            "maxLength": 60
          },
          "name_en": {
            "type": "string",
            "minLength": 1,
            "maxLength": 60
          },
          "count": {
            "type": "integer",
            "minimum": 0,
            "maximum": 1000
          }
        }
      },
      "SpecialistV1": {
        "title": "SpecialistV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "specialist_id",
          "domain_id",
          "name_ar",
          "name_en",
          "summary_ar",
          "summary_en",
          "task_types"
        ],
        "properties": {
          "specialist_id": {
            "$ref": "./desktop-p08-domain.schema.json#/$defs/SpecialistId"
          },
          "domain_id": {
            "type": "string",
            "pattern": "^[a-z0-9-]{1,48}$"
          },
          "name_ar": {
            "type": "string",
            "minLength": 1,
            "maxLength": 60
          },
          "name_en": {
            "type": "string",
            "minLength": 1,
            "maxLength": 60
          },
          "summary_ar": {
            "type": "string",
            "minLength": 1,
            "maxLength": 220
          },
          "summary_en": {
            "type": "string",
            "minLength": 1,
            "maxLength": 220
          },
          "task_types": {
            "type": "array",
            "minItems": 1,
            "maxItems": 9,
            "items": {
              "$ref": "./desktop-p03-domain.schema.json#/$defs/TaskType"
            }
          },
          "agent": {
            "$ref": "#/$defs/AgentDefinitionViewV1"
          }
        },
        "description": "A catalog specialist as the renderer shows it. Its working instructions stay in the host and reach only the model prompt. `agent` (remediation 2026-10-12) is the agent definition the host enforces when this specialist works: identity, version, tools, memory scope, budget and output contract."
      },
      "AgentDefinitionViewV1": {
        "title": "AgentDefinitionViewV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "agent_id",
          "version",
          "tools",
          "memory_namespace",
          "report_path",
          "max_turns",
          "max_tool_calls",
          "real_model_acceptance"
        ],
        "properties": {
          "agent_id": {
            "type": "string",
            "pattern": "^agent\\.[a-z0-9-]{1,48}\\.[a-z0-9-]{1,48}$"
          },
          "version": {
            "type": "string",
            "maxLength": 32
          },
          "tools": {
            "type": "array",
            "maxItems": 32,
            "items": {
              "type": "string",
              "maxLength": 80
            }
          },
          "memory_namespace": {
            "type": "string",
            "maxLength": 140
          },
          "report_path": {
            "type": "string",
            "maxLength": 200
          },
          "max_turns": {
            "type": "integer",
            "minimum": 1,
            "maximum": 100
          },
          "max_tool_calls": {
            "type": "integer",
            "minimum": 1,
            "maximum": 200
          },
          "real_model_acceptance": {
            "type": "string",
            "enum": [
              "NOT_MEASURED"
            ],
            "description": "This build does not carry a real-model acceptance result for any agent; one is recorded only from a real model run the owner authorised."
          }
        },
        "description": "An agent definition as the host enforces it (remediation 2026-10-12, section 6)."
      },
      "AgentCatalogResultV1": {
        "title": "AgentCatalogResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "domains",
          "specialists"
        ],
        "properties": {
          "domains": {
            "type": "array",
            "maxItems": 64,
            "items": {
              "$ref": "#/$defs/SpecialistDomainV1"
            }
          },
          "specialists": {
            "type": "array",
            "maxItems": 1000,
            "items": {
              "$ref": "#/$defs/SpecialistV1"
            }
          }
        }
      },
      "MissionSpecialistSetResultV1": {
        "title": "MissionSpecialistSetResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "mission_id",
          "specialist_id"
        ],
        "properties": {
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "specialist_id": {
            "anyOf": [
              {
                "$ref": "./desktop-p08-domain.schema.json#/$defs/SpecialistId"
              },
              {
                "type": "null"
              }
            ]
          }
        }
      },
      "ConversationThreadV1": {
        "title": "ConversationThreadV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "thread_id",
          "title",
          "pinned",
          "favorite",
          "archived"
        ],
        "properties": {
          "thread_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "title": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200
          },
          "project_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "pinned": {
            "type": "boolean"
          },
          "favorite": {
            "type": "boolean"
          },
          "archived": {
            "type": "boolean"
          }
        },
        "description": "A conversation as the task menu left it. A conversation without a record is not pinned, not a favourite and not archived."
      },
      "ConversationUpdateResultV1": {
        "title": "ConversationUpdateResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "thread"
        ],
        "properties": {
          "thread": {
            "$ref": "#/$defs/ConversationThreadV1"
          }
        }
      },
      "ConversationDeleteResultV1": {
        "title": "ConversationDeleteResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "thread_id",
          "deleted",
          "turns"
        ],
        "properties": {
          "thread_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "deleted": {
            "const": true
          },
          "turns": {
            "type": "integer",
            "minimum": 1,
            "maximum": 10001
          }
        }
      },
      "ProjectDeleteResultV1": {
        "title": "ProjectDeleteResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "project_id",
          "deleted",
          "detached_missions"
        ],
        "properties": {
          "project_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "deleted": {
            "const": true
          },
          "detached_missions": {
            "type": "integer",
            "minimum": 0,
            "maximum": 1000000
          }
        }
      },
      "MemoryRememberResultV1": {
        "title": "MemoryRememberResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "decision",
          "memory_id",
          "reason"
        ],
        "properties": {
          "decision": {
            "enum": [
              "PROMOTED",
              "REJECTED",
              "DUPLICATE",
              "COALESCED"
            ]
          },
          "memory_id": {
            "anyOf": [
              {
                "$ref": "./common/ids.schema.json#/$defs/Uuid"
              },
              {
                "type": "null"
              }
            ]
          },
          "reason": {
            "type": "string",
            "minLength": 1,
            "maxLength": 64
          }
        }
      },
      "ConversationSearchResultV1": {
        "title": "ConversationSearchResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "results"
        ],
        "properties": {
          "results": {
            "type": "array",
            "maxItems": 50,
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "thread_id",
                "title",
                "snippet",
                "updated_at"
              ],
              "properties": {
                "thread_id": {
                  "$ref": "./common/ids.schema.json#/$defs/Uuid"
                },
                "title": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 200
                },
                "project_id": {
                  "$ref": "./common/ids.schema.json#/$defs/Uuid"
                },
                "snippet": {
                  "type": "string",
                  "maxLength": 400
                },
                "updated_at": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 64
                }
              }
            }
          }
        }
      },
      "ProviderCatalogResultV1": {
        "title": "ProviderCatalogResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "source",
          "retrieved",
          "entries"
        ],
        "properties": {
          "source": {
            "type": "string",
            "maxLength": 256
          },
          "retrieved": {
            "type": "string",
            "maxLength": 10
          },
          "entries": {
            "type": "array",
            "maxItems": 400,
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "provider_id",
                "kind",
                "display_name",
                "display_name_key",
                "locality",
                "auth_mode",
                "enabled",
                "documented_models",
                "environment_key_present"
              ],
              "properties": {
                "provider_id": {
                  "$ref": "./desktop-p02-domain.schema.json#/$defs/ProviderId"
                },
                "kind": {
                  "$ref": "./desktop-p02-domain.schema.json#/$defs/ProviderKind"
                },
                "display_name": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 64,
                  "pattern": "^[^\\u0000-\\u001f\\u007f]*$"
                },
                "display_name_key": {
                  "$ref": "./desktop-settings.schema.json#/$defs/DisplayKey"
                },
                "locality": {
                  "$ref": "./desktop-p02-domain.schema.json#/$defs/Locality"
                },
                "auth_mode": {
                  "$ref": "./desktop-p02-domain.schema.json#/$defs/AuthMode"
                },
                "enabled": {
                  "type": "boolean"
                },
                "documented_models": {
                  "type": "integer",
                  "minimum": 0,
                  "maximum": 100000
                },
                "environment_key_present": {
                  "type": "boolean"
                },
                "environment_variable": {
                  "type": "string",
                  "pattern": "^[A-Z][A-Z0-9_]{2,63}$"
                },
                "popular_rank": {
                  "type": "integer",
                  "minimum": 1,
                  "maximum": 1000
                }
              }
            }
          }
        },
        "description": "The provider catalog (ADR-037): built-in, catalogued from a dated models.dev snapshot, and custom. No credential, and no key status read from the store."
      },
      "ProviderCustomDeleteResultV1": {
        "title": "ProviderCustomDeleteResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "provider_id",
          "removed"
        ],
        "properties": {
          "provider_id": {
            "$ref": "./desktop-p02-domain.schema.json#/$defs/ProviderId"
          },
          "removed": {
            "type": "boolean"
          }
        }
      },
      "TraceSpanV1": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "span_id",
          "trace_id",
          "name",
          "status",
          "started_at",
          "semconv"
        ],
        "properties": {
          "span_id": {
            "type": "string",
            "pattern": "^[0-9a-f]{16}$"
          },
          "trace_id": {
            "type": "string",
            "pattern": "^[0-9a-f]{32}$"
          },
          "parent_span_id": {
            "type": [
              "string",
              "null"
            ]
          },
          "name": {
            "type": "string",
            "enum": [
              "invoke_agent",
              "chat",
              "execute_tool"
            ]
          },
          "agent_id": {
            "type": [
              "string",
              "null"
            ]
          },
          "task_id": {
            "type": [
              "string",
              "null"
            ]
          },
          "model_id": {
            "type": [
              "string",
              "null"
            ],
            "maxLength": 200
          },
          "provider_id": {
            "type": [
              "string",
              "null"
            ],
            "maxLength": 80
          },
          "tool_id": {
            "type": [
              "string",
              "null"
            ],
            "maxLength": 200
          },
          "input_tokens": {
            "type": [
              "integer",
              "null"
            ],
            "minimum": 0
          },
          "output_tokens": {
            "type": [
              "integer",
              "null"
            ],
            "minimum": 0
          },
          "latency_ms": {
            "type": [
              "integer",
              "null"
            ],
            "minimum": 0
          },
          "cost_micros": {
            "type": [
              "integer",
              "null"
            ],
            "minimum": 0
          },
          "status": {
            "type": "string",
            "enum": [
              "OK",
              "ERROR",
              "DENIED",
              "AWAITING_APPROVAL",
              "CANCELLED"
            ]
          },
          "gate_decision": {
            "type": [
              "string",
              "null"
            ],
            "maxLength": 80
          },
          "started_at": {
            "type": "string",
            "maxLength": 40
          },
          "semconv": {
            "type": "string",
            "maxLength": 40
          }
        },
        "title": "TraceSpanV1",
        "description": "ADR-041: one OpenTelemetry GenAI span (invoke_agent, chat, execute_tool). The field set is pinned by semconv because the specification is still Development."
      },
      "MissionTraceResultV1": {
        "title": "MissionTraceResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "mission_id",
          "semconv",
          "spans",
          "spans_total",
          "next_after",
          "totals",
          "security_events",
          "session_events",
          "session_chain"
        ],
        "properties": {
          "mission_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "semconv": {
            "type": "string",
            "maxLength": 40
          },
          "spans": {
            "type": "array",
            "maxItems": 1000,
            "description": "PHASE-10 (CP-10-1): one page, in start order.",
            "items": {
              "$ref": "#/$defs/TraceSpanV1"
            }
          },
          "spans_total": {
            "type": "integer",
            "minimum": 0
          },
          "next_after": {
            "description": "The `after` value of the next page; null on the last page.",
            "anyOf": [
              {
                "type": "integer",
                "minimum": 0
              },
              {
                "type": "null"
              }
            ]
          },
          "totals": {
            "type": "object",
            "additionalProperties": false,
            "description": "Measured over every span of the mission, not the page. A finished model call that reported no tokens counts in unreported, never as zero.",
            "required": [
              "agents",
              "model_calls",
              "tool_calls",
              "input_tokens",
              "output_tokens",
              "unreported",
              "denied"
            ],
            "properties": {
              "agents": {
                "type": "integer",
                "minimum": 0
              },
              "model_calls": {
                "type": "integer",
                "minimum": 0
              },
              "tool_calls": {
                "type": "integer",
                "minimum": 0
              },
              "input_tokens": {
                "type": "integer",
                "minimum": 0
              },
              "output_tokens": {
                "type": "integer",
                "minimum": 0
              },
              "unreported": {
                "type": "integer",
                "minimum": 0
              },
              "denied": {
                "type": "integer",
                "minimum": 0
              }
            }
          },
          "security_events": {
            "type": "array",
            "maxItems": 100,
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "seq",
                "kind",
                "detail",
                "created_at"
              ],
              "properties": {
                "seq": {
                  "type": "integer",
                  "minimum": 1
                },
                "kind": {
                  "type": "string",
                  "maxLength": 40
                },
                "detail": {
                  "type": "string",
                  "maxLength": 300
                },
                "created_at": {
                  "type": "string",
                  "maxLength": 40
                }
              }
            }
          },
          "session_events": {
            "type": "integer",
            "minimum": 0
          },
          "session_chain": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "state"
            ],
            "properties": {
              "state": {
                "type": "string",
                "enum": [
                  "INTACT",
                  "BROKEN"
                ]
              },
              "events": {
                "type": "integer",
                "minimum": 0
              },
              "at_seq": {
                "type": "integer"
              }
            }
          },
          "otlp": {
            "type": "object",
            "description": "OTLP/JSON ResourceSpans, only when include_otlp was asked."
          }
        }
      },
      "McpAcceptRedefinitionResultV1": {
        "title": "McpAcceptRedefinitionResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "tool_id",
          "accepted",
          "pending"
        ],
        "properties": {
          "tool_id": {
            "type": "string",
            "maxLength": 300
          },
          "accepted": {
            "type": "boolean"
          },
          "pending": {
            "type": "array",
            "maxItems": 500,
            "items": {
              "type": "string",
              "maxLength": 300
            }
          }
        }
      }
    }
  } as unknown as SchemaDocument,
  "desktop-request.v1.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "DesktopRequestPayloadV1",
    "description": "The closed set of request payloads the five Phase-01 desktop operations accept. Every payload is a closed object; there is no Record<string, unknown> escape hatch and no arbitrary JSON anywhere in the set.",
    "$comment": "الاتحاد هنا يعطي المجموعة اسمًا وملفًا واحدًا. سلطة الربط بين العملية وحمولتها ليست هنا بل في IPCEnvelopeV1: هناك يُقيَّد كل operation بحمولته بالضبط، وهنا تُعرَّف الأشكال وتُولَّد أنواعها.",
    "anyOf": [
      {
        "$ref": "#/$defs/DesktopBootstrapRequestV1"
      },
      {
        "$ref": "#/$defs/DesktopRuntimeStatusRequestV1"
      },
      {
        "$ref": "#/$defs/DesktopCapabilityAvailabilityRequestV1"
      },
      {
        "$ref": "#/$defs/DesktopSettingsDescribeRequestV1"
      },
      {
        "$ref": "#/$defs/DesktopSettingsReadRequestV1"
      }
    ],
    "$defs": {
      "DesktopBootstrapRequestV1": {
        "title": "DesktopBootstrapRequestV1",
        "type": "object",
        "additionalProperties": false,
        "properties": {},
        "description": "Bootstrap takes no parameters. It is an empty closed object rather than an absent payload: the envelope already requires `payload`, and a closed empty object states that nothing may be smuggled in beside it. The contract version travels on the envelope, so the payload does not restate it."
      },
      "DesktopRuntimeStatusRequestV1": {
        "title": "DesktopRuntimeStatusRequestV1",
        "type": "object",
        "additionalProperties": false,
        "properties": {},
        "description": "Runtime status takes no parameters, for the same reason as bootstrap."
      },
      "DesktopCapabilityAvailabilityRequestV1": {
        "title": "DesktopCapabilityAvailabilityRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "capability_ids"
        ],
        "properties": {
          "capability_ids": {
            "type": "array",
            "minItems": 1,
            "maxItems": 64,
            "uniqueItems": true,
            "items": {
              "$ref": "./common/ids.schema.json#/$defs/Slug"
            },
            "description": "A bounded, explicit query. There is deliberately no 'all capabilities' wildcard: an unbounded query is a small dispatcher."
          }
        }
      },
      "DesktopSettingsDescribeRequestV1": {
        "title": "DesktopSettingsDescribeRequestV1",
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "section_ids": {
            "type": "array",
            "minItems": 1,
            "maxItems": 32,
            "uniqueItems": true,
            "items": {
              "$ref": "./desktop-settings.schema.json#/$defs/SettingSectionId"
            },
            "description": "Restricts the description to the named sections. Absent means the whole tree, which is bounded by the host's own section catalogue and not by the caller."
          }
        }
      },
      "DesktopSettingsReadRequestV1": {
        "title": "DesktopSettingsReadRequestV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "section_id"
        ],
        "properties": {
          "section_id": {
            "$ref": "./desktop-settings.schema.json#/$defs/SettingSectionId"
          },
          "setting_ids": {
            "type": "array",
            "minItems": 1,
            "maxItems": 64,
            "uniqueItems": true,
            "items": {
              "$ref": "./desktop-settings.schema.json#/$defs/SettingId"
            },
            "description": "Restricts the read to named settings inside the section. Absent means the whole section."
          }
        },
        "description": "Reads one named section. A read spanning sections is not expressible, so a single request can never become a settings dump."
      }
    }
  } as unknown as SchemaDocument,
  "desktop-result.v1.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "DesktopResultPayloadV1",
    "description": "The closed set of result payloads the five Phase-01 desktop operations return. Each is a closed object carrying shell facts only.",
    "$comment": "ResponseEnvelope لا يحمل حقل operation، فلا يستطيع المخطط وحده ربط النتيجة بعمليتها. الربط يقع على البوابة عبر request_id والسجل، وهذا حدّ مُعلن في PHASE-01-IPC-CONTRACTS.md لا ثغرة مسكوت عنها. وDesktopBootstrapResultV1 مرجع مجرّد بلا حقول مجاورة عمدًا: $ref ومعه title أو description يُفقد مُفكِّك المراجع قاعدةَ العنوان فتنكسر المراجع الداخلية للوثيقة المُشار إليها. الشرح مكانه الوثيقة لا المخطط.",
    "anyOf": [
      {
        "$ref": "#/$defs/DesktopBootstrapResultV1"
      },
      {
        "$ref": "#/$defs/DesktopRuntimeStatusResultV1"
      },
      {
        "$ref": "#/$defs/DesktopCapabilityAvailabilityResultV1"
      },
      {
        "$ref": "#/$defs/DesktopSettingsDescribeResultV1"
      },
      {
        "$ref": "#/$defs/DesktopSettingsReadResultV1"
      }
    ],
    "$defs": {
      "DesktopBootstrapResultV1": {
        "$ref": "./desktop-bootstrap.schema.json#/$defs/BootstrapSnapshot"
      },
      "DesktopRuntimeStatusResultV1": {
        "title": "DesktopRuntimeStatusResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "runtime_status",
          "observed_at"
        ],
        "properties": {
          "runtime_status": {
            "$ref": "./desktop-bootstrap.schema.json#/$defs/RuntimeStatus"
          },
          "observed_at": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp",
            "description": "When the host observed this. The shell caches status as a query result with an explicit staleness story, and cannot tell a stale answer from a fresh one without this."
          }
        }
      },
      "DesktopCapabilityAvailabilityResultV1": {
        "title": "DesktopCapabilityAvailabilityResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "capabilities"
        ],
        "properties": {
          "capabilities": {
            "type": "array",
            "maxItems": 64,
            "items": {
              "$ref": "./desktop-availability.schema.json#/$defs/CapabilityAvailability"
            },
            "description": "One entry per capability the request named. A capability the host does not know is answered UNAVAILABLE with a reason, never omitted silently."
          }
        }
      },
      "DesktopSettingsDescribeResultV1": {
        "title": "DesktopSettingsDescribeResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "settings_schema_version",
          "sections"
        ],
        "properties": {
          "settings_schema_version": {
            "$ref": "./common/ids.schema.json#/$defs/ContractVersion"
          },
          "sections": {
            "type": "array",
            "maxItems": 32,
            "items": {
              "$ref": "./desktop-settings.schema.json#/$defs/SettingSectionDescriptor"
            }
          }
        },
        "description": "Structure and per-setting mode. No value of any kind appears in a describe result."
      },
      "DesktopSettingsReadResultV1": {
        "title": "DesktopSettingsReadResultV1",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "section_id",
          "settings"
        ],
        "properties": {
          "section_id": {
            "$ref": "./desktop-settings.schema.json#/$defs/SettingSectionId"
          },
          "settings": {
            "type": "array",
            "maxItems": 64,
            "items": {
              "$ref": "./desktop-settings.schema.json#/$defs/ResolvedSetting"
            }
          }
        },
        "description": "Resolved, display-safe values for one section. A secret-bearing setting is reported as configured and its value is withheld."
      }
    }
  } as unknown as SchemaDocument,
  "desktop-settings.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "PolarisDesktopSettingsPrimitives",
    "description": "An honest structural description of the settings surface, and display-safe resolved values. The host stays the single settings resolver; this contract lets the shell describe and read, never resolve and never see a secret.",
    "$comment": "الواجهة عميل للمُحلِّل الموثوق ولا تصير محلِّلًا ثانيًا. الواصف يصف البنية والوضع، والقراءة تعيد قيمًا آمنة للعرض فقط.",
    "$defs": {
      "SettingSectionId": {
        "title": "SettingSectionId",
        "$ref": "./common/ids.schema.json#/$defs/Slug",
        "description": "Identifier of a settings section. Bounded as a Slug rather than enumerated: the section catalogue is P01-W6's to decide, while its shape is settled here. A free string is still unrepresentable."
      },
      "SettingId": {
        "title": "SettingId",
        "$ref": "./common/ids.schema.json#/$defs/Slug",
        "description": "Identifier of one setting inside a section."
      },
      "DisplayKey": {
        "title": "DisplayKey",
        "type": "string",
        "pattern": "^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$",
        "maxLength": 160,
        "description": "Localization key, not localized prose. The contract carries the key; the renderer resolves the text. A translated string never crosses this boundary."
      },
      "SettingMode": {
        "title": "SettingMode",
        "type": "string",
        "enum": [
          "ACTIVE",
          "READ_ONLY",
          "UNAVAILABLE_THIS_PHASE"
        ],
        "description": "What the user may actually do with the setting. A control that looks editable while doing nothing is the failure this enum exists to prevent."
      },
      "SettingValueKind": {
        "title": "SettingValueKind",
        "type": "string",
        "enum": [
          "BOOLEAN",
          "INTEGER",
          "TEXT",
          "ENUM",
          "LOCALE",
          "APPEARANCE"
        ],
        "description": "The shape of the value the setting holds. Closed: an unknown kind is a contract change, not a rendering fallback."
      },
      "SettingDescriptor": {
        "title": "SettingDescriptor",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "setting_id",
          "value_kind",
          "mode",
          "label_key"
        ],
        "properties": {
          "setting_id": {
            "$ref": "#/$defs/SettingId"
          },
          "value_kind": {
            "$ref": "#/$defs/SettingValueKind"
          },
          "mode": {
            "$ref": "#/$defs/SettingMode"
          },
          "label_key": {
            "$ref": "#/$defs/DisplayKey"
          },
          "description_key": {
            "$ref": "#/$defs/DisplayKey"
          },
          "availability_reason": {
            "$ref": "./desktop-availability.schema.json#/$defs/AvailabilityReason",
            "description": "Required whenever the mode is not ACTIVE."
          },
          "allowed_values": {
            "type": "array",
            "maxItems": 32,
            "uniqueItems": true,
            "items": {
              "type": "string",
              "maxLength": 64,
              "pattern": "^[A-Za-z][A-Za-z0-9_-]*$"
            },
            "description": "Permitted members for an ENUM-kind setting. Bounded tokens, never localized labels."
          }
        },
        "allOf": [
          {
            "$comment": "وضعٌ غير ACTIVE يوجب سببًا مصنّفًا، وإلا صار «معطّل» بلا تفسير.",
            "if": {
              "type": "object",
              "properties": {
                "mode": {
                  "enum": [
                    "READ_ONLY",
                    "UNAVAILABLE_THIS_PHASE"
                  ]
                }
              },
              "required": [
                "mode"
              ]
            },
            "then": {
              "type": "object",
              "required": [
                "availability_reason"
              ]
            }
          },
          {
            "$comment": "قائمة القيم المسموح بها تخصّ ENUM وحدها.",
            "if": {
              "type": "object",
              "properties": {
                "value_kind": {
                  "const": "ENUM"
                }
              },
              "required": [
                "value_kind"
              ]
            },
            "then": {
              "type": "object",
              "required": [
                "allowed_values"
              ]
            }
          }
        ],
        "description": "One setting, described structurally. No value is carried here — describing is not reading."
      },
      "SettingSectionDescriptor": {
        "title": "SettingSectionDescriptor",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "section_id",
          "label_key",
          "mode",
          "settings"
        ],
        "properties": {
          "section_id": {
            "$ref": "#/$defs/SettingSectionId"
          },
          "label_key": {
            "$ref": "#/$defs/DisplayKey"
          },
          "mode": {
            "$ref": "#/$defs/SettingMode"
          },
          "availability_reason": {
            "$ref": "./desktop-availability.schema.json#/$defs/AvailabilityReason"
          },
          "settings": {
            "type": "array",
            "maxItems": 64,
            "items": {
              "$ref": "#/$defs/SettingDescriptor"
            }
          }
        },
        "allOf": [
          {
            "$comment": "نفس قاعدة الوضع على مستوى القسم.",
            "if": {
              "type": "object",
              "properties": {
                "mode": {
                  "enum": [
                    "READ_ONLY",
                    "UNAVAILABLE_THIS_PHASE"
                  ]
                }
              },
              "required": [
                "mode"
              ]
            },
            "then": {
              "type": "object",
              "required": [
                "availability_reason"
              ]
            }
          }
        ]
      },
      "DisplaySafeValue": {
        "title": "DisplaySafeValue",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "kind"
        ],
        "properties": {
          "kind": {
            "$ref": "#/$defs/SettingValueKind"
          },
          "boolean_value": {
            "type": "boolean"
          },
          "integer_value": {
            "type": "integer",
            "minimum": -2147483648,
            "maximum": 2147483647
          },
          "text_value": {
            "type": "string",
            "maxLength": 256,
            "description": "Display-safe text only. Secret-bearing settings are never resolved through this path; the secret-hygiene rules reject credential shapes here."
          },
          "code_value": {
            "type": "string",
            "maxLength": 64,
            "pattern": "^[A-Za-z][A-Za-z0-9_-]*$",
            "description": "A bounded token for ENUM, LOCALE and APPEARANCE kinds. Named code_value, not value, so that nothing free-form can be smuggled under a generic name."
          }
        },
        "description": "A resolved value in display-safe form. One field per kind rather than an untyped `value`, so an unexpected shape cannot pass validation."
      },
      "ResolvedSetting": {
        "title": "ResolvedSetting",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "setting_id",
          "mode"
        ],
        "properties": {
          "setting_id": {
            "$ref": "#/$defs/SettingId"
          },
          "mode": {
            "$ref": "#/$defs/SettingMode"
          },
          "value": {
            "$ref": "#/$defs/DisplaySafeValue",
            "description": "Absent whenever the host will not disclose a value — a secret-bearing setting, or one unavailable in this phase. Absence is the honest answer; a placeholder is not."
          },
          "availability_reason": {
            "$ref": "./desktop-availability.schema.json#/$defs/AvailabilityReason"
          },
          "value_withheld": {
            "type": "boolean",
            "description": "True when the host holds a value and will not disclose it — a credential-backed setting above all. The value member is then always absent. The field states the observable fact rather than classifying the data behind it, and its name deliberately avoids credential vocabulary: the secret detector matches on key names, so a contract field called secret_* or *_token would be rejected by the project's own hygiene rule."
          }
        },
        "allOf": [
          {
            "$comment": "إعداد يحمل سرًّا لا يُصاحبه قيمة أبدًا. معرفة أن السرّ مضبوط شيء، وتسليمه شيء آخر.",
            "if": {
              "type": "object",
              "properties": {
                "value_withheld": {
                  "const": true
                }
              },
              "required": [
                "value_withheld"
              ]
            },
            "then": {
              "not": {
                "type": "object",
                "required": [
                  "value"
                ]
              }
            }
          },
          {
            "$comment": "وضعٌ غير ACTIVE يوجب سببًا.",
            "if": {
              "type": "object",
              "properties": {
                "mode": {
                  "enum": [
                    "READ_ONLY",
                    "UNAVAILABLE_THIS_PHASE"
                  ]
                }
              },
              "required": [
                "mode"
              ]
            },
            "then": {
              "type": "object",
              "required": [
                "availability_reason"
              ]
            }
          }
        ]
      }
    }
  } as unknown as SchemaDocument,
  "ipc-envelope.v1.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "IPCEnvelopeV1",
    "description": "The single framing for every trust-crossing message between the POLARIS desktop surface and the trusted native core. Three closed message shapes; there is no fourth and no open extension point.",
    "$comment": "اتحاد مميّز صريح بثلاثة أشكال. كل شكل مغلق، فلا يمكن لرسالة أن تحمل حقول شكل آخر. مُميِّز صريح على message_type حتى تُنسب أخطاء الرفض إلى الشكل المقصود لا إلى كل الفروع.",
    "type": "object",
    "oneOf": [
      {
        "$ref": "#/$defs/RequestEnvelope"
      },
      {
        "$ref": "#/$defs/ResponseEnvelope"
      },
      {
        "$ref": "#/$defs/EventEnvelope"
      }
    ],
    "$defs": {
      "Operation": {
        "title": "Operation",
        "type": "string",
        "enum": [
          "capability.describe",
          "capability.invoke",
          "policy.evaluate",
          "audit.append",
          "model.complete",
          "system.ping",
          "desktop.bootstrap",
          "desktop.runtime.status",
          "desktop.capability.availability",
          "desktop.settings.describe",
          "desktop.settings.read",
          "provider.list",
          "provider.configure",
          "provider.credential.set",
          "provider.credential.clear",
          "provider.refresh",
          "model.list",
          "model.configure",
          "model.preferences.set",
          "model.invoke",
          "model.cancel",
          "project.list",
          "project.get",
          "project.create",
          "project.update",
          "project.archive",
          "context.add",
          "context.remove",
          "context.preview",
          "context.assemble",
          "mission.list",
          "mission.get",
          "mission.create",
          "mission.start",
          "mission.cancel",
          "mission.resume",
          "task.list",
          "agent.list",
          "claim.list",
          "evidence.list",
          "skill.list",
          "skill.get",
          "skill.configure",
          "tool.list",
          "tool.get",
          "tool.activity.list",
          "mcp.list",
          "mcp.register",
          "mcp.configure",
          "mcp.refresh",
          "approval.list",
          "tool.approval.respond",
          "memory.list",
          "memory.get",
          "memory.delete",
          "browser.session.list",
          "browser.session.get",
          "browser.session.cancel",
          "computer.session.list",
          "computer.session.get",
          "computer.session.cancel",
          "computer.window.list",
          "computer.target.grant",
          "computer.target.revoke",
          "connector.list",
          "connector.get",
          "connector.register",
          "connector.configure",
          "connector.remove",
          "connector.test",
          "connector.credential.set",
          "connector.credential.clear",
          "connector.openapi.import",
          "connector.openapi.approve",
          "connector.preset.list",
          "connector.preset.register",
          "usage.summary",
          "usage.list",
          "budget.list",
          "budget.set",
          "budget.remove",
          "pricing.list",
          "pricing.set",
          "pricing.remove",
          "observability.health",
          "observability.events",
          "observability.metrics",
          "observability.errors",
          "observability.alerts",
          "diagnostics.export",
          "config.describe",
          "config.effective",
          "config.set",
          "config.reset",
          "workspace.list",
          "workspace.preview",
          "workspace.export",
          "attachment.stage",
          "attachment.discard",
          "attachment.artifact.stage",
          "attachment.list",
          "attachment.bind",
          "artifact.list",
          "artifact.get",
          "execution.status",
          "execution.runs",
          "execution.runtime.prepare",
          "mission.model.set",
          "schedule.list",
          "schedule.save",
          "schedule.enable",
          "schedule.delete",
          "schedule.run_now",
          "oauth.list",
          "oauth.connect",
          "oauth.disconnect",
          "voice.transcribe",
          "share.list",
          "share.set",
          "publish.list",
          "publish.propose",
          "publish.decide",
          "skill.package.list",
          "skill.package.import",
          "device.export",
          "device.import",
          "integration.settings.set",
          "conversation.begin",
          "conversation.continue",
          "conversation.get",
          "conversation.index",
          "agent.catalog",
          "mission.specialist.set",
          "conversation.update",
          "conversation.delete",
          "project.delete",
          "memory.remember",
          "conversation.search",
          "mission.trace",
          "mcp.tool.accept_redefinition",
          "provider.catalog",
          "provider.credential.put",
          "provider.custom.save",
          "provider.custom.delete",
          "web.search.status",
          "web.search.credential.put",
          "web.search.test",
          "mission.rating.set",
          "mission.note.add",
          "tool.approval.grants",
          "tool.approval.grant.revoke",
          "github.status",
          "github.connect",
          "github.disconnect",
          "memory.semantic.status",
          "memory.semantic.set",
          "memory.semantic.test"
        ],
        "description": "Closed operation set. An arbitrary operation name is unrepresentable, not merely rejected at runtime. The five desktop.* members were added additively at 1.1 (ADR-017); the nineteen provider.*, model.*, project.* and context.* members were added additively at 1.2 (ADR-019); the ten mission.*, task.*, agent.*, claim.* and evidence.* members were added additively at 1.3 (ADR-021); the twelve skill.*, tool.*, mcp.* and approval.* members were added additively at 1.4 (ADR-023); the twelve memory.*, browser.session.*, computer.session.*, computer.window.* and computer.target.* members were added additively at 1.5 (ADR-025). The twenty-eight connector.*, usage.*, budget.*, pricing.*, observability.*, diagnostics.* and config.* members were added additively at 1.6 (ADR-026). The thirty-two workspace.*, attachment.*, artifact.*, execution.*, mission.model.set, schedule.*, oauth.*, voice.transcribe, share.*, publish.*, skill.package.*, device.* and integration.settings.set members were added additively at 1.7 (ADR-028), and the four conversation.* members were added additively at 1.7 later (ADR-029), and agent.catalog and mission.specialist.set later still (ADR-030). The set is no more open than it was at 1.0. The four provider.catalog, provider.credential.put, provider.custom.save and provider.custom.delete members were added additively at 1.7 later still (ADR-037). The ten web.search.*, mission.rating.set, mission.note.add, tool.approval.grants, tool.approval.grant.revoke and github.* members were added additively at 1.7 later still (ADR-042)."
      },
      "RequestEnvelope": {
        "title": "RequestEnvelope",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "contract_version",
          "protocol_version",
          "message_type",
          "message_id",
          "correlation_id",
          "session_id",
          "caller_identity",
          "timestamp",
          "operation",
          "payload"
        ],
        "properties": {
          "contract_version": {
            "$ref": "./common/ids.schema.json#/$defs/ContractVersion"
          },
          "protocol_version": {
            "$ref": "./common/ids.schema.json#/$defs/ContractVersion"
          },
          "message_type": {
            "const": "REQUEST"
          },
          "message_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "correlation_id": {
            "$ref": "./common/ids.schema.json#/$defs/CorrelationId"
          },
          "causation_id": {
            "$ref": "./common/ids.schema.json#/$defs/CausationId"
          },
          "session_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "caller_identity": {
            "$ref": "./common/caller-identity.schema.json#/$defs/CallerIdentity"
          },
          "timestamp": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          },
          "operation": {
            "$ref": "#/$defs/Operation"
          },
          "payload": {
            "type": "object"
          },
          "idempotency_key": {
            "$ref": "./common/ids.schema.json#/$defs/IdempotencyKey"
          }
        },
        "allOf": [
          {
            "$comment": "العمليات ذات الأثر الجانبي تتطلب مفتاح Idempotency ثابتًا عبر إعادة المحاولة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "enum": [
                    "capability.invoke",
                    "audit.append",
                    "provider.configure",
                    "provider.credential.set",
                    "provider.credential.clear",
                    "provider.refresh",
                    "model.configure",
                    "model.preferences.set",
                    "model.invoke",
                    "model.cancel",
                    "project.create",
                    "project.update",
                    "project.archive",
                    "context.add",
                    "context.remove",
                    "mission.create",
                    "mission.start",
                    "mission.cancel",
                    "mission.resume",
                    "skill.configure",
                    "mcp.register",
                    "mcp.configure",
                    "mcp.refresh",
                    "tool.approval.respond",
                    "memory.delete",
                    "browser.session.cancel",
                    "computer.session.cancel",
                    "computer.target.grant",
                    "computer.target.revoke",
                    "connector.register",
                    "connector.configure",
                    "connector.remove",
                    "connector.test",
                    "connector.credential.set",
                    "connector.credential.clear",
                    "connector.openapi.import",
                    "connector.openapi.approve",
                    "connector.preset.register",
                    "budget.set",
                    "budget.remove",
                    "pricing.set",
                    "pricing.remove",
                    "diagnostics.export",
                    "config.set",
                    "config.reset",
                    "workspace.export",
                    "attachment.stage",
                    "attachment.discard",
                    "attachment.artifact.stage",
                    "attachment.bind",
                    "execution.runtime.prepare",
                    "mission.model.set",
                    "schedule.save",
                    "schedule.enable",
                    "schedule.delete",
                    "schedule.run_now",
                    "oauth.connect",
                    "oauth.disconnect",
                    "voice.transcribe",
                    "share.set",
                    "publish.propose",
                    "publish.decide",
                    "skill.package.import",
                    "device.export",
                    "device.import",
                    "integration.settings.set",
                    "conversation.begin",
                    "conversation.continue",
                    "provider.credential.put",
                    "provider.custom.save",
                    "provider.custom.delete",
                    "web.search.credential.put",
                    "web.search.test",
                    "mission.rating.set",
                    "mission.note.add",
                    "tool.approval.grant.revoke",
                    "github.connect",
                    "github.disconnect",
                    "memory.semantic.set",
                    "memory.semantic.test",
                    "conversation.update",
                    "conversation.delete",
                    "project.delete",
                    "memory.remember",
                    "mission.specialist.set",
                    "mcp.tool.accept_redefinition"
                  ]
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "required": [
                "idempotency_key"
              ]
            }
          },
          {
            "$comment": "ربط كل عملية سطح مكتب بحمولتها بالضبط. بلا هذا الربط يبقى payload كائنًا مفتوحًا، ويصير الحدّ الموثوق بابًا يقبل أي JSON تحت اسم عملية معروفة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "desktop.bootstrap"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-request.v1.schema.json#/$defs/DesktopBootstrapRequestV1"
                }
              }
            }
          },
          {
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "desktop.runtime.status"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-request.v1.schema.json#/$defs/DesktopRuntimeStatusRequestV1"
                }
              }
            }
          },
          {
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "desktop.capability.availability"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-request.v1.schema.json#/$defs/DesktopCapabilityAvailabilityRequestV1"
                }
              }
            }
          },
          {
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "desktop.settings.describe"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-request.v1.schema.json#/$defs/DesktopSettingsDescribeRequestV1"
                }
              }
            }
          },
          {
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "desktop.settings.read"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-request.v1.schema.json#/$defs/DesktopSettingsReadRequestV1"
                }
              }
            }
          },
          {
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "provider.list"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p02-request.v1.schema.json#/$defs/ProviderListRequestV1"
                }
              }
            }
          },
          {
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "provider.configure"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p02-request.v1.schema.json#/$defs/ProviderConfigureRequestV1"
                }
              }
            }
          },
          {
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "provider.credential.set"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p02-request.v1.schema.json#/$defs/ProviderCredentialSetRequestV1"
                }
              }
            }
          },
          {
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "provider.credential.clear"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p02-request.v1.schema.json#/$defs/ProviderCredentialClearRequestV1"
                }
              }
            }
          },
          {
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "provider.refresh"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p02-request.v1.schema.json#/$defs/ProviderRefreshRequestV1"
                }
              }
            }
          },
          {
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "model.list"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p02-request.v1.schema.json#/$defs/ModelListRequestV1"
                }
              }
            }
          },
          {
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "model.configure"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p02-request.v1.schema.json#/$defs/ModelConfigureRequestV1"
                }
              }
            }
          },
          {
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "model.preferences.set"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p02-request.v1.schema.json#/$defs/ModelPreferencesSetRequestV1"
                }
              }
            }
          },
          {
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "model.invoke"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p02-request.v1.schema.json#/$defs/ModelInvokeRequestV1"
                }
              }
            }
          },
          {
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "model.cancel"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p02-request.v1.schema.json#/$defs/ModelCancelRequestV1"
                }
              }
            }
          },
          {
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "project.list"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p02-request.v1.schema.json#/$defs/ProjectListRequestV1"
                }
              }
            }
          },
          {
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "project.get"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p02-request.v1.schema.json#/$defs/ProjectGetRequestV1"
                }
              }
            }
          },
          {
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "project.create"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p02-request.v1.schema.json#/$defs/ProjectCreateRequestV1"
                }
              }
            }
          },
          {
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "project.update"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p02-request.v1.schema.json#/$defs/ProjectUpdateRequestV1"
                }
              }
            }
          },
          {
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "project.archive"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p02-request.v1.schema.json#/$defs/ProjectArchiveRequestV1"
                }
              }
            }
          },
          {
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "context.add"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p02-request.v1.schema.json#/$defs/ContextAddRequestV1"
                }
              }
            }
          },
          {
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "context.remove"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p02-request.v1.schema.json#/$defs/ContextRemoveRequestV1"
                }
              }
            }
          },
          {
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "context.preview"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p02-request.v1.schema.json#/$defs/ContextPreviewRequestV1"
                }
              }
            }
          },
          {
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "context.assemble"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p02-request.v1.schema.json#/$defs/ContextAssembleRequestV1"
                }
              }
            }
          },
          {
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "mission.list"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p03-request.v1.schema.json#/$defs/MissionListRequestV1"
                }
              }
            }
          },
          {
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "mission.get"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p03-request.v1.schema.json#/$defs/MissionGetRequestV1"
                }
              }
            }
          },
          {
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "mission.create"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p03-request.v1.schema.json#/$defs/MissionCreateRequestV1"
                }
              }
            }
          },
          {
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "mission.start"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p03-request.v1.schema.json#/$defs/MissionStartRequestV1"
                }
              }
            }
          },
          {
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "mission.cancel"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p03-request.v1.schema.json#/$defs/MissionCancelRequestV1"
                }
              }
            }
          },
          {
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "mission.resume"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p03-request.v1.schema.json#/$defs/MissionResumeRequestV1"
                }
              }
            }
          },
          {
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "task.list"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p03-request.v1.schema.json#/$defs/TaskListRequestV1"
                }
              }
            }
          },
          {
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "agent.list"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p03-request.v1.schema.json#/$defs/AgentListRequestV1"
                }
              }
            }
          },
          {
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "claim.list"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p03-request.v1.schema.json#/$defs/ClaimListRequestV1"
                }
              }
            }
          },
          {
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "evidence.list"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p03-request.v1.schema.json#/$defs/EvidenceListRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط skill.list بحمولتها. الحمولة مغلقة، ولا تحمل اسم أداة غير مسجَّل ولا حجج تنفيذ.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "skill.list"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p04-request.v1.schema.json#/$defs/SkillListRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط skill.get بحمولتها. الحمولة مغلقة، ولا تحمل اسم أداة غير مسجَّل ولا حجج تنفيذ.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "skill.get"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p04-request.v1.schema.json#/$defs/SkillGetRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط skill.configure بحمولتها. الحمولة مغلقة، ولا تحمل اسم أداة غير مسجَّل ولا حجج تنفيذ.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "skill.configure"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p04-request.v1.schema.json#/$defs/SkillConfigureRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط tool.list بحمولتها. الحمولة مغلقة، ولا تحمل اسم أداة غير مسجَّل ولا حجج تنفيذ.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "tool.list"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p04-request.v1.schema.json#/$defs/ToolListRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط tool.get بحمولتها. الحمولة مغلقة، ولا تحمل اسم أداة غير مسجَّل ولا حجج تنفيذ.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "tool.get"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p04-request.v1.schema.json#/$defs/ToolGetRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط tool.activity.list بحمولتها. الحمولة مغلقة، ولا تحمل اسم أداة غير مسجَّل ولا حجج تنفيذ.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "tool.activity.list"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p04-request.v1.schema.json#/$defs/ToolActivityListRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط mcp.list بحمولتها. الحمولة مغلقة، ولا تحمل اسم أداة غير مسجَّل ولا حجج تنفيذ.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "mcp.list"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p04-request.v1.schema.json#/$defs/McpListRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط mcp.register بحمولتها. الحمولة مغلقة، ولا تحمل اسم أداة غير مسجَّل ولا حجج تنفيذ.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "mcp.register"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p04-request.v1.schema.json#/$defs/McpRegisterRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط mcp.configure بحمولتها. الحمولة مغلقة، ولا تحمل اسم أداة غير مسجَّل ولا حجج تنفيذ.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "mcp.configure"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p04-request.v1.schema.json#/$defs/McpConfigureRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط mcp.refresh بحمولتها. الحمولة مغلقة، ولا تحمل اسم أداة غير مسجَّل ولا حجج تنفيذ.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "mcp.refresh"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p04-request.v1.schema.json#/$defs/McpRefreshRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط approval.list بحمولتها. الحمولة مغلقة، ولا تحمل اسم أداة غير مسجَّل ولا حجج تنفيذ.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "approval.list"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p04-request.v1.schema.json#/$defs/ApprovalListRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط tool.approval.respond بحمولتها. الحمولة مغلقة، ولا تحمل اسم أداة غير مسجَّل ولا حجج تنفيذ.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "tool.approval.respond"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p04-request.v1.schema.json#/$defs/ToolApprovalRespondRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط memory.list بحمولتها. الحمولة مغلقة: لا وجهة ويب، ولا إدخال، ولا مسار ملف حرّ، ولا ترقية ذاكرة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "memory.list"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p05-request.v1.schema.json#/$defs/MemoryListRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط memory.get بحمولتها. الحمولة مغلقة: لا وجهة ويب، ولا إدخال، ولا مسار ملف حرّ، ولا ترقية ذاكرة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "memory.get"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p05-request.v1.schema.json#/$defs/MemoryGetRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط memory.delete بحمولتها. الحمولة مغلقة: لا وجهة ويب، ولا إدخال، ولا مسار ملف حرّ، ولا ترقية ذاكرة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "memory.delete"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p05-request.v1.schema.json#/$defs/MemoryDeleteRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط browser.session.list بحمولتها. الحمولة مغلقة: لا وجهة ويب، ولا إدخال، ولا مسار ملف حرّ، ولا ترقية ذاكرة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "browser.session.list"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p05-request.v1.schema.json#/$defs/BrowserSessionListRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط browser.session.get بحمولتها. الحمولة مغلقة: لا وجهة ويب، ولا إدخال، ولا مسار ملف حرّ، ولا ترقية ذاكرة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "browser.session.get"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p05-request.v1.schema.json#/$defs/BrowserSessionGetRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط browser.session.cancel بحمولتها. الحمولة مغلقة: لا وجهة ويب، ولا إدخال، ولا مسار ملف حرّ، ولا ترقية ذاكرة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "browser.session.cancel"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p05-request.v1.schema.json#/$defs/BrowserSessionCancelRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط computer.session.list بحمولتها. الحمولة مغلقة: لا وجهة ويب، ولا إدخال، ولا مسار ملف حرّ، ولا ترقية ذاكرة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "computer.session.list"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p05-request.v1.schema.json#/$defs/ComputerSessionListRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط computer.session.get بحمولتها. الحمولة مغلقة: لا وجهة ويب، ولا إدخال، ولا مسار ملف حرّ، ولا ترقية ذاكرة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "computer.session.get"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p05-request.v1.schema.json#/$defs/ComputerSessionGetRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط computer.session.cancel بحمولتها. الحمولة مغلقة: لا وجهة ويب، ولا إدخال، ولا مسار ملف حرّ، ولا ترقية ذاكرة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "computer.session.cancel"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p05-request.v1.schema.json#/$defs/ComputerSessionCancelRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط computer.window.list بحمولتها. الحمولة مغلقة: لا وجهة ويب، ولا إدخال، ولا مسار ملف حرّ، ولا ترقية ذاكرة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "computer.window.list"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p05-request.v1.schema.json#/$defs/ComputerWindowListRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط computer.target.grant بحمولتها. الحمولة مغلقة: لا وجهة ويب، ولا إدخال، ولا مسار ملف حرّ، ولا ترقية ذاكرة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "computer.target.grant"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p05-request.v1.schema.json#/$defs/ComputerTargetGrantRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط computer.target.revoke بحمولتها. الحمولة مغلقة: لا وجهة ويب، ولا إدخال، ولا مسار ملف حرّ، ولا ترقية ذاكرة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "computer.target.revoke"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p05-request.v1.schema.json#/$defs/ComputerTargetRevokeRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط connector.list بحمولتها. الحمولة مغلقة: لا نداء موصل، ولا سرّ، ولا عنوان حرّ يختاره وكيل.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "connector.list"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p06-request.v1.schema.json#/$defs/ConnectorListRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط connector.get بحمولتها. الحمولة مغلقة: لا نداء موصل، ولا سرّ، ولا عنوان حرّ يختاره وكيل.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "connector.get"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p06-request.v1.schema.json#/$defs/ConnectorGetRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط connector.register بحمولتها. الحمولة مغلقة: لا نداء موصل، ولا سرّ، ولا عنوان حرّ يختاره وكيل.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "connector.register"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p06-request.v1.schema.json#/$defs/ConnectorRegisterRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط connector.configure بحمولتها. الحمولة مغلقة: لا نداء موصل، ولا سرّ، ولا عنوان حرّ يختاره وكيل.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "connector.configure"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p06-request.v1.schema.json#/$defs/ConnectorConfigureRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط connector.remove بحمولتها. الحمولة مغلقة: لا نداء موصل، ولا سرّ، ولا عنوان حرّ يختاره وكيل.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "connector.remove"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p06-request.v1.schema.json#/$defs/ConnectorRemoveRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط connector.test بحمولتها. الحمولة مغلقة: لا نداء موصل، ولا سرّ، ولا عنوان حرّ يختاره وكيل.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "connector.test"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p06-request.v1.schema.json#/$defs/ConnectorTestRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط connector.credential.set بحمولتها. الحمولة مغلقة: لا نداء موصل، ولا سرّ، ولا عنوان حرّ يختاره وكيل.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "connector.credential.set"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p06-request.v1.schema.json#/$defs/ConnectorCredentialSetRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط connector.credential.clear بحمولتها. الحمولة مغلقة: لا نداء موصل، ولا سرّ، ولا عنوان حرّ يختاره وكيل.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "connector.credential.clear"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p06-request.v1.schema.json#/$defs/ConnectorCredentialClearRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط connector.openapi.import بحمولتها. الحمولة مغلقة: لا نداء موصل، ولا سرّ، ولا عنوان حرّ يختاره وكيل.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "connector.openapi.import"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p06-request.v1.schema.json#/$defs/ConnectorOpenapiImportRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط connector.openapi.approve بحمولتها. الحمولة مغلقة: لا نداء موصل، ولا سرّ، ولا عنوان حرّ يختاره وكيل.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "connector.openapi.approve"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p06-request.v1.schema.json#/$defs/ConnectorOpenapiApproveRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط connector.preset.list بحمولتها. الحمولة مغلقة: لا عنوان ولا ترويسة ولا سرّ من العارض.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "connector.preset.list"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p06-request.v1.schema.json#/$defs/ConnectorPresetListRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط connector.preset.register بحمولتها. الحمولة مغلقة: لا عنوان ولا ترويسة ولا سرّ من العارض.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "connector.preset.register"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p06-request.v1.schema.json#/$defs/ConnectorPresetRegisterRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط usage.summary بحمولتها. الحمولة مغلقة: لا نداء موصل، ولا سرّ، ولا عنوان حرّ يختاره وكيل.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "usage.summary"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p06-request.v1.schema.json#/$defs/UsageSummaryRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط usage.list بحمولتها. الحمولة مغلقة: لا نداء موصل، ولا سرّ، ولا عنوان حرّ يختاره وكيل.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "usage.list"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p06-request.v1.schema.json#/$defs/UsageListRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط budget.list بحمولتها. الحمولة مغلقة: لا نداء موصل، ولا سرّ، ولا عنوان حرّ يختاره وكيل.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "budget.list"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p06-request.v1.schema.json#/$defs/BudgetListRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط budget.set بحمولتها. الحمولة مغلقة: لا نداء موصل، ولا سرّ، ولا عنوان حرّ يختاره وكيل.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "budget.set"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p06-request.v1.schema.json#/$defs/BudgetSetRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط budget.remove بحمولتها. الحمولة مغلقة: لا نداء موصل، ولا سرّ، ولا عنوان حرّ يختاره وكيل.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "budget.remove"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p06-request.v1.schema.json#/$defs/BudgetRemoveRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط pricing.list بحمولتها. الحمولة مغلقة: لا نداء موصل، ولا سرّ، ولا عنوان حرّ يختاره وكيل.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "pricing.list"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p06-request.v1.schema.json#/$defs/PricingListRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط pricing.set بحمولتها. الحمولة مغلقة: لا نداء موصل، ولا سرّ، ولا عنوان حرّ يختاره وكيل.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "pricing.set"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p06-request.v1.schema.json#/$defs/PricingSetRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط pricing.remove بحمولتها. الحمولة مغلقة: لا نداء موصل، ولا سرّ، ولا عنوان حرّ يختاره وكيل.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "pricing.remove"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p06-request.v1.schema.json#/$defs/PricingRemoveRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط observability.health بحمولتها. الحمولة مغلقة: لا نداء موصل، ولا سرّ، ولا عنوان حرّ يختاره وكيل.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "observability.health"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p06-request.v1.schema.json#/$defs/ObservabilityHealthRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط observability.events بحمولتها. الحمولة مغلقة: لا نداء موصل، ولا سرّ، ولا عنوان حرّ يختاره وكيل.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "observability.events"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p06-request.v1.schema.json#/$defs/ObservabilityEventsRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط observability.metrics بحمولتها. الحمولة مغلقة: لا نداء موصل، ولا سرّ، ولا عنوان حرّ يختاره وكيل.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "observability.metrics"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p06-request.v1.schema.json#/$defs/ObservabilityMetricsRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط observability.errors بحمولتها. الحمولة مغلقة: لا نداء موصل، ولا سرّ، ولا عنوان حرّ يختاره وكيل.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "observability.errors"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p06-request.v1.schema.json#/$defs/ObservabilityErrorsRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط observability.alerts بحمولتها. الحمولة مغلقة: لا نداء موصل، ولا سرّ، ولا عنوان حرّ يختاره وكيل.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "observability.alerts"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p06-request.v1.schema.json#/$defs/ObservabilityAlertsRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط diagnostics.export بحمولتها. الحمولة مغلقة: لا نداء موصل، ولا سرّ، ولا عنوان حرّ يختاره وكيل.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "diagnostics.export"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p06-request.v1.schema.json#/$defs/DiagnosticsExportRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط config.describe بحمولتها. الحمولة مغلقة: لا نداء موصل، ولا سرّ، ولا عنوان حرّ يختاره وكيل.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "config.describe"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p06-request.v1.schema.json#/$defs/ConfigDescribeRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط config.effective بحمولتها. الحمولة مغلقة: لا نداء موصل، ولا سرّ، ولا عنوان حرّ يختاره وكيل.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "config.effective"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p06-request.v1.schema.json#/$defs/ConfigEffectiveRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط config.set بحمولتها. الحمولة مغلقة: لا نداء موصل، ولا سرّ، ولا عنوان حرّ يختاره وكيل.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "config.set"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p06-request.v1.schema.json#/$defs/ConfigSetRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط config.reset بحمولتها. الحمولة مغلقة: لا نداء موصل، ولا سرّ، ولا عنوان حرّ يختاره وكيل.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "config.reset"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p06-request.v1.schema.json#/$defs/ConfigResetRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط workspace.list بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "workspace.list"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/WorkspaceListRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط workspace.preview بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "workspace.preview"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/WorkspacePreviewRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط workspace.export بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "workspace.export"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/WorkspaceExportRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط attachment.stage بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "attachment.stage"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/AttachmentStageRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط attachment.artifact.stage بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "attachment.artifact.stage"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/AttachmentArtifactStageRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط attachment.discard بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "attachment.discard"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/AttachmentDiscardRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط attachment.list بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "attachment.list"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/AttachmentListRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط attachment.bind بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "attachment.bind"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/AttachmentBindRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط artifact.list بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "artifact.list"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/ArtifactListRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط artifact.get بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "artifact.get"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/ArtifactGetRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط execution.status بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "execution.status"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/ExecutionStatusRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط execution.runs بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "execution.runs"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/ExecutionRunsRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط execution.runtime.prepare بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "execution.runtime.prepare"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/ExecutionRuntimePrepareRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط mission.model.set بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "mission.model.set"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/MissionModelSetRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط schedule.list بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "schedule.list"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/ScheduleListRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط schedule.save بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "schedule.save"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/ScheduleSaveRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط schedule.enable بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "schedule.enable"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/ScheduleEnableRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط schedule.delete بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "schedule.delete"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/ScheduleDeleteRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط schedule.run_now بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "schedule.run_now"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/ScheduleRunNowRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط oauth.list بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "oauth.list"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/OauthListRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط oauth.connect بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "oauth.connect"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/OauthConnectRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط oauth.disconnect بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "oauth.disconnect"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/OauthDisconnectRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط voice.transcribe بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "voice.transcribe"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/VoiceTranscribeRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط share.list بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "share.list"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/ShareListRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط share.set بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "share.set"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/ShareSetRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط publish.list بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "publish.list"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/PublishListRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط publish.propose بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "publish.propose"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/PublishProposeRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط publish.decide بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "publish.decide"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/PublishDecideRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط skill.package.list بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "skill.package.list"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/SkillPackageListRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط skill.package.import بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "skill.package.import"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/SkillPackageImportRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط device.export بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "device.export"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/DeviceExportRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط device.import بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "device.import"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/DeviceImportRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط integration.settings.set بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "integration.settings.set"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/IntegrationSettingsSetRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط conversation.begin بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "conversation.begin"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/ConversationBeginRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط conversation.continue بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "conversation.continue"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/ConversationContinueRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط conversation.get بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "conversation.get"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/ConversationGetRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط conversation.index بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "conversation.index"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/ConversationIndexRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط agent.catalog بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "agent.catalog"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/AgentCatalogRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط mission.specialist.set بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "mission.specialist.set"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/MissionSpecialistSetRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط conversation.update بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "conversation.update"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/ConversationUpdateRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط conversation.delete بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "conversation.delete"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/ConversationDeleteRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط project.delete بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "project.delete"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/ProjectDeleteRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط memory.remember بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "memory.remember"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/MemoryRememberRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط conversation.search بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "conversation.search"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/ConversationSearchRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط mission.trace بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "mission.trace"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/MissionTraceRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط mcp.tool.accept_redefinition بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "mcp.tool.accept_redefinition"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/McpAcceptRedefinitionRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط provider.catalog بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "provider.catalog"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/ProviderCatalogRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط provider.credential.put بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "provider.credential.put"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/ProviderCredentialPutRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط provider.custom.save بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "provider.custom.save"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/ProviderCustomSaveRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط provider.custom.delete بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "provider.custom.delete"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/ProviderCustomDeleteRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط web.search.status بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "web.search.status"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/WebSearchStatusRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط web.search.credential.put بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "web.search.credential.put"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/WebSearchCredentialPutRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط web.search.test بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "web.search.test"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/WebSearchTestRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط mission.rating.set بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "mission.rating.set"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/MissionRatingSetRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط mission.note.add بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "mission.note.add"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/MissionNoteAddRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط tool.approval.grants بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "tool.approval.grants"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/ToolApprovalGrantsRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط tool.approval.grant.revoke بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "tool.approval.grant.revoke"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/ToolApprovalGrantRevokeRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط github.status بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "github.status"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/GitHubStatusRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط github.connect بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "github.connect"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/GitHubConnectRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط github.disconnect بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "github.disconnect"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/GitHubDisconnectRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط memory.semantic.status بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "memory.semantic.status"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/MemorySemanticStatusRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط memory.semantic.set بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "memory.semantic.set"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/MemorySemanticSetRequestV1"
                }
              }
            }
          },
          {
            "$comment": "ربط memory.semantic.test بحمولتها. الحمولة مغلقة.",
            "if": {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "memory.semantic.test"
                }
              },
              "required": [
                "operation"
              ]
            },
            "then": {
              "type": "object",
              "properties": {
                "payload": {
                  "$ref": "./desktop-p08-request.v1.schema.json#/$defs/MemorySemanticTestRequestV1"
                }
              }
            }
          }
        ]
      },
      "ResponseEnvelope": {
        "title": "ResponseEnvelope",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "contract_version",
          "protocol_version",
          "message_type",
          "message_id",
          "request_id",
          "correlation_id",
          "session_id",
          "caller_identity",
          "timestamp"
        ],
        "properties": {
          "contract_version": {
            "$ref": "./common/ids.schema.json#/$defs/ContractVersion"
          },
          "protocol_version": {
            "$ref": "./common/ids.schema.json#/$defs/ContractVersion"
          },
          "message_type": {
            "const": "RESPONSE"
          },
          "message_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "request_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid",
            "description": "message_id of the REQUEST being answered."
          },
          "correlation_id": {
            "$ref": "./common/ids.schema.json#/$defs/CorrelationId"
          },
          "causation_id": {
            "$ref": "./common/ids.schema.json#/$defs/CausationId"
          },
          "session_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "caller_identity": {
            "$ref": "./common/caller-identity.schema.json#/$defs/CallerIdentity"
          },
          "timestamp": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          },
          "result": {
            "type": "object"
          },
          "error": {
            "$ref": "./common/error.schema.json#/$defs/ContractError"
          }
        },
        "allOf": [
          {
            "$comment": "نتيجة أو خطأ، لا كلاهما.",
            "if": {
              "type": "object",
              "required": [
                "result"
              ]
            },
            "then": {
              "not": {
                "type": "object",
                "required": [
                  "error"
                ]
              }
            }
          },
          {
            "$comment": "غياب النتيجة يوجب وجود الخطأ.",
            "if": {
              "not": {
                "type": "object",
                "required": [
                  "result"
                ]
              }
            },
            "then": {
              "type": "object",
              "required": [
                "error"
              ]
            }
          }
        ]
      },
      "EventEnvelope": {
        "title": "EventEnvelope",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "contract_version",
          "protocol_version",
          "message_type",
          "message_id",
          "correlation_id",
          "session_id",
          "caller_identity",
          "timestamp",
          "event_name",
          "payload"
        ],
        "properties": {
          "contract_version": {
            "$ref": "./common/ids.schema.json#/$defs/ContractVersion"
          },
          "protocol_version": {
            "$ref": "./common/ids.schema.json#/$defs/ContractVersion"
          },
          "message_type": {
            "const": "EVENT"
          },
          "message_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "correlation_id": {
            "$ref": "./common/ids.schema.json#/$defs/CorrelationId"
          },
          "causation_id": {
            "$ref": "./common/ids.schema.json#/$defs/CausationId"
          },
          "session_id": {
            "$ref": "./common/ids.schema.json#/$defs/Uuid"
          },
          "caller_identity": {
            "$ref": "./common/caller-identity.schema.json#/$defs/CallerIdentity"
          },
          "timestamp": {
            "$ref": "./common/ids.schema.json#/$defs/Timestamp"
          },
          "event_name": {
            "$ref": "./common/ids.schema.json#/$defs/Slug"
          },
          "payload": {
            "type": "object"
          }
        }
      }
    },
    "discriminator": {
      "propertyName": "message_type"
    }
  } as unknown as SchemaDocument,
};

/** سجل عمليات Phase-01، كما هو على القرص. */
export const IPC_REGISTRY = {
  "contract_version": "1.0",
  "phase": "PHASE-01",
  "envelope_contract": "IPCEnvelopeV1",
  "implementation_status": "SPECIFIED",
  "operations": [
    {
      "operation": "desktop.bootstrap",
      "envelope_version": "1.1",
      "request_schema": "desktop-request.v1.schema.json#/$defs/DesktopBootstrapRequestV1",
      "response_schema": "desktop-result.v1.schema.json#/$defs/DesktopBootstrapResultV1",
      "owner": "BootstrapService",
      "effect": "READ_ONLY",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-01"
    },
    {
      "operation": "desktop.runtime.status",
      "envelope_version": "1.1",
      "request_schema": "desktop-request.v1.schema.json#/$defs/DesktopRuntimeStatusRequestV1",
      "response_schema": "desktop-result.v1.schema.json#/$defs/DesktopRuntimeStatusResultV1",
      "owner": "RuntimeStatusService",
      "effect": "READ_ONLY",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-01"
    },
    {
      "operation": "desktop.capability.availability",
      "envelope_version": "1.1",
      "request_schema": "desktop-request.v1.schema.json#/$defs/DesktopCapabilityAvailabilityRequestV1",
      "response_schema": "desktop-result.v1.schema.json#/$defs/DesktopCapabilityAvailabilityResultV1",
      "owner": "CapabilityAvailabilityService",
      "effect": "READ_ONLY",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-01"
    },
    {
      "operation": "desktop.settings.describe",
      "envelope_version": "1.1",
      "request_schema": "desktop-request.v1.schema.json#/$defs/DesktopSettingsDescribeRequestV1",
      "response_schema": "desktop-result.v1.schema.json#/$defs/DesktopSettingsDescribeResultV1",
      "owner": "SettingsFacade",
      "effect": "READ_ONLY",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-01"
    },
    {
      "operation": "desktop.settings.read",
      "envelope_version": "1.1",
      "request_schema": "desktop-request.v1.schema.json#/$defs/DesktopSettingsReadRequestV1",
      "response_schema": "desktop-result.v1.schema.json#/$defs/DesktopSettingsReadResultV1",
      "owner": "SettingsFacade",
      "effect": "READ_ONLY",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-01"
    }
  ]
} as const;

/** سجل عمليات Phase-02 (ADR-019)، كما هو على القرص. */
export const PHASE02_IPC_REGISTRY = {
  "contract_version": "1.2",
  "phase": "PHASE-02",
  "envelope_contract": "IPCEnvelopeV1",
  "implementation_status": "IMPLEMENTED",
  "operations": [
    {
      "operation": "provider.list",
      "envelope_version": "1.2",
      "request_schema": "desktop-p02-request.v1.schema.json#/$defs/ProviderListRequestV1",
      "response_schema": "desktop-p02-result.v1.schema.json#/$defs/ProviderListResultV1",
      "owner": "ProviderRegistryService",
      "effect": "READ_ONLY",
      "effect_class": "READ",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-02"
    },
    {
      "operation": "provider.configure",
      "envelope_version": "1.2",
      "request_schema": "desktop-p02-request.v1.schema.json#/$defs/ProviderConfigureRequestV1",
      "response_schema": "desktop-p02-result.v1.schema.json#/$defs/ProviderConfigureResultV1",
      "owner": "ProviderConfigService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "WRITE_CONFIG",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "FEATURE_NOT_AVAILABLE",
        "PERMISSION_DENIED"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-02"
    },
    {
      "operation": "provider.credential.set",
      "envelope_version": "1.2",
      "request_schema": "desktop-p02-request.v1.schema.json#/$defs/ProviderCredentialSetRequestV1",
      "response_schema": "desktop-p02-result.v1.schema.json#/$defs/ProviderCredentialResultV1",
      "owner": "SecretBrokerService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "SECRET_WRITE",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-02"
    },
    {
      "operation": "provider.credential.clear",
      "envelope_version": "1.2",
      "request_schema": "desktop-p02-request.v1.schema.json#/$defs/ProviderCredentialClearRequestV1",
      "response_schema": "desktop-p02-result.v1.schema.json#/$defs/ProviderCredentialResultV1",
      "owner": "SecretBrokerService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "SECRET_WRITE",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-02"
    },
    {
      "operation": "provider.refresh",
      "envelope_version": "1.2",
      "request_schema": "desktop-p02-request.v1.schema.json#/$defs/ProviderRefreshRequestV1",
      "response_schema": "desktop-p02-result.v1.schema.json#/$defs/ProviderRefreshResultV1",
      "owner": "ModelDiscoveryService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "NETWORK_PROBE",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-02"
    },
    {
      "operation": "model.list",
      "envelope_version": "1.2",
      "request_schema": "desktop-p02-request.v1.schema.json#/$defs/ModelListRequestV1",
      "response_schema": "desktop-p02-result.v1.schema.json#/$defs/ModelListResultV1",
      "owner": "ModelRegistryService",
      "effect": "READ_ONLY",
      "effect_class": "READ",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-02"
    },
    {
      "operation": "model.configure",
      "envelope_version": "1.2",
      "request_schema": "desktop-p02-request.v1.schema.json#/$defs/ModelConfigureRequestV1",
      "response_schema": "desktop-p02-result.v1.schema.json#/$defs/ModelConfigureResultV1",
      "owner": "ModelRegistryService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "WRITE_CONFIG",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-02"
    },
    {
      "operation": "model.preferences.set",
      "envelope_version": "1.2",
      "request_schema": "desktop-p02-request.v1.schema.json#/$defs/ModelPreferencesSetRequestV1",
      "response_schema": "desktop-p02-result.v1.schema.json#/$defs/ModelPreferencesSetResultV1",
      "owner": "ModelSelectionService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "WRITE_CONFIG",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-02"
    },
    {
      "operation": "model.invoke",
      "envelope_version": "1.2",
      "request_schema": "desktop-p02-request.v1.schema.json#/$defs/ModelInvokeRequestV1",
      "response_schema": "desktop-p02-result.v1.schema.json#/$defs/ModelInvokeResultV1",
      "owner": "ModelInvocationService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "MODEL_INVOCATION",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "FEATURE_NOT_AVAILABLE",
        "PERMISSION_DENIED"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-02"
    },
    {
      "operation": "model.cancel",
      "envelope_version": "1.2",
      "request_schema": "desktop-p02-request.v1.schema.json#/$defs/ModelCancelRequestV1",
      "response_schema": "desktop-p02-result.v1.schema.json#/$defs/ModelCancelResultV1",
      "owner": "ModelInvocationService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "CONTROL",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-02"
    },
    {
      "operation": "project.list",
      "envelope_version": "1.2",
      "request_schema": "desktop-p02-request.v1.schema.json#/$defs/ProjectListRequestV1",
      "response_schema": "desktop-p02-result.v1.schema.json#/$defs/ProjectListResultV1",
      "owner": "ProjectService",
      "effect": "READ_ONLY",
      "effect_class": "READ",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-02"
    },
    {
      "operation": "project.get",
      "envelope_version": "1.2",
      "request_schema": "desktop-p02-request.v1.schema.json#/$defs/ProjectGetRequestV1",
      "response_schema": "desktop-p02-result.v1.schema.json#/$defs/ProjectGetResultV1",
      "owner": "ProjectService",
      "effect": "READ_ONLY",
      "effect_class": "READ",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-02"
    },
    {
      "operation": "project.create",
      "envelope_version": "1.2",
      "request_schema": "desktop-p02-request.v1.schema.json#/$defs/ProjectCreateRequestV1",
      "response_schema": "desktop-p02-result.v1.schema.json#/$defs/ProjectMutationResultV1",
      "owner": "ProjectService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "CREATE_LOCAL_DATA",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-02"
    },
    {
      "operation": "project.update",
      "envelope_version": "1.2",
      "request_schema": "desktop-p02-request.v1.schema.json#/$defs/ProjectUpdateRequestV1",
      "response_schema": "desktop-p02-result.v1.schema.json#/$defs/ProjectMutationResultV1",
      "owner": "ProjectService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "WRITE_LOCAL_DATA",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-02"
    },
    {
      "operation": "project.archive",
      "envelope_version": "1.2",
      "request_schema": "desktop-p02-request.v1.schema.json#/$defs/ProjectArchiveRequestV1",
      "response_schema": "desktop-p02-result.v1.schema.json#/$defs/ProjectMutationResultV1",
      "owner": "ProjectService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "WRITE_LOCAL_DATA",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-02"
    },
    {
      "operation": "context.add",
      "envelope_version": "1.2",
      "request_schema": "desktop-p02-request.v1.schema.json#/$defs/ContextAddRequestV1",
      "response_schema": "desktop-p02-result.v1.schema.json#/$defs/ContextSourceResultV1",
      "owner": "ContextSourceService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "CREATE_LOCAL_DATA",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "FEATURE_NOT_AVAILABLE",
        "PERMISSION_DENIED"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-02"
    },
    {
      "operation": "context.remove",
      "envelope_version": "1.2",
      "request_schema": "desktop-p02-request.v1.schema.json#/$defs/ContextRemoveRequestV1",
      "response_schema": "desktop-p02-result.v1.schema.json#/$defs/ContextSourceResultV1",
      "owner": "ContextSourceService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "WRITE_LOCAL_DATA",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-02"
    },
    {
      "operation": "context.preview",
      "envelope_version": "1.2",
      "request_schema": "desktop-p02-request.v1.schema.json#/$defs/ContextPreviewRequestV1",
      "response_schema": "desktop-p02-result.v1.schema.json#/$defs/ContextPreviewResultV1",
      "owner": "ContextPreviewService",
      "effect": "READ_ONLY",
      "effect_class": "READ_RESOURCE",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "FEATURE_NOT_AVAILABLE",
        "PERMISSION_DENIED"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-02"
    },
    {
      "operation": "context.assemble",
      "envelope_version": "1.2",
      "request_schema": "desktop-p02-request.v1.schema.json#/$defs/ContextAssembleRequestV1",
      "response_schema": "desktop-p02-result.v1.schema.json#/$defs/ContextAssembleResultV1",
      "owner": "ContextAssemblyService",
      "effect": "READ_ONLY",
      "effect_class": "READ_RESOURCE",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "FEATURE_NOT_AVAILABLE",
        "PERMISSION_DENIED"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-02"
    }
  ]
} as const;

/** سجل عمليات Phase-03 (ADR-021)، كما هو على القرص. */
export const PHASE03_IPC_REGISTRY = {
  "contract_version": "1.3",
  "phase": "PHASE-03",
  "envelope_contract": "IPCEnvelopeV1",
  "implementation_status": "IMPLEMENTED",
  "operations": [
    {
      "operation": "mission.list",
      "envelope_version": "1.3",
      "request_schema": "desktop-p03-request.v1.schema.json#/$defs/MissionListRequestV1",
      "response_schema": "desktop-p03-result.v1.schema.json#/$defs/MissionListResultV1",
      "owner": "MissionService",
      "effect": "READ_ONLY",
      "effect_class": "READ",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-03"
    },
    {
      "operation": "mission.get",
      "envelope_version": "1.3",
      "request_schema": "desktop-p03-request.v1.schema.json#/$defs/MissionGetRequestV1",
      "response_schema": "desktop-p03-result.v1.schema.json#/$defs/MissionGetResultV1",
      "owner": "MissionService",
      "effect": "READ_ONLY",
      "effect_class": "READ",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-03"
    },
    {
      "operation": "mission.create",
      "envelope_version": "1.3",
      "request_schema": "desktop-p03-request.v1.schema.json#/$defs/MissionCreateRequestV1",
      "response_schema": "desktop-p03-result.v1.schema.json#/$defs/MissionCreateResultV1",
      "owner": "MissionService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "CREATE_LOCAL_DATA",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "FEATURE_NOT_AVAILABLE",
        "PERMISSION_DENIED"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-03"
    },
    {
      "operation": "mission.start",
      "envelope_version": "1.3",
      "request_schema": "desktop-p03-request.v1.schema.json#/$defs/MissionStartRequestV1",
      "response_schema": "desktop-p03-result.v1.schema.json#/$defs/MissionStartResultV1",
      "owner": "MissionOrchestrationService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "CONTROL",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "FEATURE_NOT_AVAILABLE",
        "PERMISSION_DENIED"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-03"
    },
    {
      "operation": "mission.cancel",
      "envelope_version": "1.3",
      "request_schema": "desktop-p03-request.v1.schema.json#/$defs/MissionCancelRequestV1",
      "response_schema": "desktop-p03-result.v1.schema.json#/$defs/MissionCancelResultV1",
      "owner": "MissionOrchestrationService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "CONTROL",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "FEATURE_NOT_AVAILABLE",
        "PERMISSION_DENIED"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-03"
    },
    {
      "operation": "mission.resume",
      "envelope_version": "1.3",
      "request_schema": "desktop-p03-request.v1.schema.json#/$defs/MissionResumeRequestV1",
      "response_schema": "desktop-p03-result.v1.schema.json#/$defs/MissionResumeResultV1",
      "owner": "MissionOrchestrationService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "CONTROL",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "FEATURE_NOT_AVAILABLE",
        "PERMISSION_DENIED"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-03"
    },
    {
      "operation": "task.list",
      "envelope_version": "1.3",
      "request_schema": "desktop-p03-request.v1.schema.json#/$defs/TaskListRequestV1",
      "response_schema": "desktop-p03-result.v1.schema.json#/$defs/TaskListResultV1",
      "owner": "TaskGraphService",
      "effect": "READ_ONLY",
      "effect_class": "READ",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-03"
    },
    {
      "operation": "agent.list",
      "envelope_version": "1.3",
      "request_schema": "desktop-p03-request.v1.schema.json#/$defs/AgentListRequestV1",
      "response_schema": "desktop-p03-result.v1.schema.json#/$defs/AgentListResultV1",
      "owner": "AgentRuntimeService",
      "effect": "READ_ONLY",
      "effect_class": "READ",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-03"
    },
    {
      "operation": "claim.list",
      "envelope_version": "1.3",
      "request_schema": "desktop-p03-request.v1.schema.json#/$defs/ClaimListRequestV1",
      "response_schema": "desktop-p03-result.v1.schema.json#/$defs/ClaimListResultV1",
      "owner": "ClaimService",
      "effect": "READ_ONLY",
      "effect_class": "READ",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-03"
    },
    {
      "operation": "evidence.list",
      "envelope_version": "1.3",
      "request_schema": "desktop-p03-request.v1.schema.json#/$defs/EvidenceListRequestV1",
      "response_schema": "desktop-p03-result.v1.schema.json#/$defs/EvidenceListResultV1",
      "owner": "EvidenceService",
      "effect": "READ_ONLY",
      "effect_class": "READ",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-03"
    }
  ]
} as const;

/** سجل عمليات Phase-04 (ADR-023)، كما هو على القرص. */
export const PHASE04_IPC_REGISTRY = {
  "contract_version": "1.4",
  "phase": "PHASE-04",
  "envelope_contract": "IPCEnvelopeV1",
  "implementation_status": "IMPLEMENTED",
  "operations": [
    {
      "operation": "skill.list",
      "envelope_version": "1.4",
      "request_schema": "desktop-p04-request.v1.schema.json#/$defs/SkillListRequestV1",
      "response_schema": "desktop-p04-result.v1.schema.json#/$defs/SkillListResultV1",
      "owner": "SkillRegistryService",
      "effect": "READ_ONLY",
      "effect_class": "READ",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-04"
    },
    {
      "operation": "skill.get",
      "envelope_version": "1.4",
      "request_schema": "desktop-p04-request.v1.schema.json#/$defs/SkillGetRequestV1",
      "response_schema": "desktop-p04-result.v1.schema.json#/$defs/SkillGetResultV1",
      "owner": "SkillRegistryService",
      "effect": "READ_ONLY",
      "effect_class": "READ",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-04"
    },
    {
      "operation": "skill.configure",
      "envelope_version": "1.4",
      "request_schema": "desktop-p04-request.v1.schema.json#/$defs/SkillConfigureRequestV1",
      "response_schema": "desktop-p04-result.v1.schema.json#/$defs/SkillConfigureResultV1",
      "owner": "SkillRegistryService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "WRITE_LOCAL_DATA",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "FEATURE_NOT_AVAILABLE",
        "PERMISSION_DENIED"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-04"
    },
    {
      "operation": "tool.list",
      "envelope_version": "1.4",
      "request_schema": "desktop-p04-request.v1.schema.json#/$defs/ToolListRequestV1",
      "response_schema": "desktop-p04-result.v1.schema.json#/$defs/ToolListResultV1",
      "owner": "ToolRegistryService",
      "effect": "READ_ONLY",
      "effect_class": "READ",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-04"
    },
    {
      "operation": "tool.get",
      "envelope_version": "1.4",
      "request_schema": "desktop-p04-request.v1.schema.json#/$defs/ToolGetRequestV1",
      "response_schema": "desktop-p04-result.v1.schema.json#/$defs/ToolGetResultV1",
      "owner": "ToolRegistryService",
      "effect": "READ_ONLY",
      "effect_class": "READ",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-04"
    },
    {
      "operation": "tool.activity.list",
      "envelope_version": "1.4",
      "request_schema": "desktop-p04-request.v1.schema.json#/$defs/ToolActivityListRequestV1",
      "response_schema": "desktop-p04-result.v1.schema.json#/$defs/ToolActivityListResultV1",
      "owner": "ToolActivityService",
      "effect": "READ_ONLY",
      "effect_class": "READ",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-04"
    },
    {
      "operation": "mcp.list",
      "envelope_version": "1.4",
      "request_schema": "desktop-p04-request.v1.schema.json#/$defs/McpListRequestV1",
      "response_schema": "desktop-p04-result.v1.schema.json#/$defs/McpListResultV1",
      "owner": "McpServerService",
      "effect": "READ_ONLY",
      "effect_class": "READ",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-04"
    },
    {
      "operation": "mcp.register",
      "envelope_version": "1.4",
      "request_schema": "desktop-p04-request.v1.schema.json#/$defs/McpRegisterRequestV1",
      "response_schema": "desktop-p04-result.v1.schema.json#/$defs/McpRegisterResultV1",
      "owner": "McpServerService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "CREATE_LOCAL_DATA",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "FEATURE_NOT_AVAILABLE",
        "PERMISSION_DENIED"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-04"
    },
    {
      "operation": "mcp.configure",
      "envelope_version": "1.4",
      "request_schema": "desktop-p04-request.v1.schema.json#/$defs/McpConfigureRequestV1",
      "response_schema": "desktop-p04-result.v1.schema.json#/$defs/McpConfigureResultV1",
      "owner": "McpServerService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "WRITE_LOCAL_DATA",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "FEATURE_NOT_AVAILABLE",
        "PERMISSION_DENIED"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-04"
    },
    {
      "operation": "mcp.refresh",
      "envelope_version": "1.4",
      "request_schema": "desktop-p04-request.v1.schema.json#/$defs/McpRefreshRequestV1",
      "response_schema": "desktop-p04-result.v1.schema.json#/$defs/McpRefreshResultV1",
      "owner": "McpDiscoveryService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "NETWORK_PROBE",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "FEATURE_NOT_AVAILABLE",
        "PERMISSION_DENIED"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-04"
    },
    {
      "operation": "approval.list",
      "envelope_version": "1.4",
      "request_schema": "desktop-p04-request.v1.schema.json#/$defs/ApprovalListRequestV1",
      "response_schema": "desktop-p04-result.v1.schema.json#/$defs/ApprovalListResultV1",
      "owner": "ToolApprovalService",
      "effect": "READ_ONLY",
      "effect_class": "READ",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-04"
    },
    {
      "operation": "tool.approval.respond",
      "envelope_version": "1.4",
      "request_schema": "desktop-p04-request.v1.schema.json#/$defs/ToolApprovalRespondRequestV1",
      "response_schema": "desktop-p04-result.v1.schema.json#/$defs/ToolApprovalRespondResultV1",
      "owner": "ToolApprovalService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "CONTROL",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "FEATURE_NOT_AVAILABLE",
        "PERMISSION_DENIED"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-04"
    }
  ]
} as const;

/** سجل عمليات Phase-05 (ADR-025)، كما هو على القرص. */
export const PHASE05_IPC_REGISTRY = {
  "contract_version": "1.5",
  "phase": "PHASE-05",
  "envelope_contract": "IPCEnvelopeV1",
  "implementation_status": "IMPLEMENTED",
  "operations": [
    {
      "operation": "memory.list",
      "envelope_version": "1.5",
      "request_schema": "desktop-p05-request.v1.schema.json#/$defs/MemoryListRequestV1",
      "response_schema": "desktop-p05-result.v1.schema.json#/$defs/MemoryListResultV1",
      "owner": "MemoryService",
      "effect": "READ_ONLY",
      "effect_class": "READ",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-05"
    },
    {
      "operation": "memory.get",
      "envelope_version": "1.5",
      "request_schema": "desktop-p05-request.v1.schema.json#/$defs/MemoryGetRequestV1",
      "response_schema": "desktop-p05-result.v1.schema.json#/$defs/MemoryGetResultV1",
      "owner": "MemoryService",
      "effect": "READ_ONLY",
      "effect_class": "READ",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-05"
    },
    {
      "operation": "memory.delete",
      "envelope_version": "1.5",
      "request_schema": "desktop-p05-request.v1.schema.json#/$defs/MemoryDeleteRequestV1",
      "response_schema": "desktop-p05-result.v1.schema.json#/$defs/MemoryDeleteResultV1",
      "owner": "MemoryService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "WRITE_LOCAL_DATA",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "FEATURE_NOT_AVAILABLE",
        "PERMISSION_DENIED"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-05"
    },
    {
      "operation": "browser.session.list",
      "envelope_version": "1.5",
      "request_schema": "desktop-p05-request.v1.schema.json#/$defs/BrowserSessionListRequestV1",
      "response_schema": "desktop-p05-result.v1.schema.json#/$defs/BrowserSessionListResultV1",
      "owner": "BrowserSessionService",
      "effect": "READ_ONLY",
      "effect_class": "READ",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-05"
    },
    {
      "operation": "browser.session.get",
      "envelope_version": "1.5",
      "request_schema": "desktop-p05-request.v1.schema.json#/$defs/BrowserSessionGetRequestV1",
      "response_schema": "desktop-p05-result.v1.schema.json#/$defs/BrowserSessionGetResultV1",
      "owner": "BrowserSessionService",
      "effect": "READ_ONLY",
      "effect_class": "READ",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-05"
    },
    {
      "operation": "browser.session.cancel",
      "envelope_version": "1.5",
      "request_schema": "desktop-p05-request.v1.schema.json#/$defs/BrowserSessionCancelRequestV1",
      "response_schema": "desktop-p05-result.v1.schema.json#/$defs/SessionCancelResultV1",
      "owner": "BrowserSessionService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "CONTROL",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "FEATURE_NOT_AVAILABLE",
        "PERMISSION_DENIED"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-05"
    },
    {
      "operation": "computer.session.list",
      "envelope_version": "1.5",
      "request_schema": "desktop-p05-request.v1.schema.json#/$defs/ComputerSessionListRequestV1",
      "response_schema": "desktop-p05-result.v1.schema.json#/$defs/ComputerSessionListResultV1",
      "owner": "ComputerSessionService",
      "effect": "READ_ONLY",
      "effect_class": "READ",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-05"
    },
    {
      "operation": "computer.session.get",
      "envelope_version": "1.5",
      "request_schema": "desktop-p05-request.v1.schema.json#/$defs/ComputerSessionGetRequestV1",
      "response_schema": "desktop-p05-result.v1.schema.json#/$defs/ComputerSessionGetResultV1",
      "owner": "ComputerSessionService",
      "effect": "READ_ONLY",
      "effect_class": "READ",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-05"
    },
    {
      "operation": "computer.session.cancel",
      "envelope_version": "1.5",
      "request_schema": "desktop-p05-request.v1.schema.json#/$defs/ComputerSessionCancelRequestV1",
      "response_schema": "desktop-p05-result.v1.schema.json#/$defs/SessionCancelResultV1",
      "owner": "ComputerSessionService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "CONTROL",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "FEATURE_NOT_AVAILABLE",
        "PERMISSION_DENIED"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-05"
    },
    {
      "operation": "computer.window.list",
      "envelope_version": "1.5",
      "request_schema": "desktop-p05-request.v1.schema.json#/$defs/ComputerWindowListRequestV1",
      "response_schema": "desktop-p05-result.v1.schema.json#/$defs/ComputerWindowListResultV1",
      "owner": "ComputerTargetService",
      "effect": "READ_ONLY",
      "effect_class": "READ",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-05"
    },
    {
      "operation": "computer.target.grant",
      "envelope_version": "1.5",
      "request_schema": "desktop-p05-request.v1.schema.json#/$defs/ComputerTargetGrantRequestV1",
      "response_schema": "desktop-p05-result.v1.schema.json#/$defs/ComputerTargetGrantResultV1",
      "owner": "ComputerTargetService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "WRITE_LOCAL_DATA",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "FEATURE_NOT_AVAILABLE",
        "PERMISSION_DENIED"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-05"
    },
    {
      "operation": "computer.target.revoke",
      "envelope_version": "1.5",
      "request_schema": "desktop-p05-request.v1.schema.json#/$defs/ComputerTargetRevokeRequestV1",
      "response_schema": "desktop-p05-result.v1.schema.json#/$defs/ComputerTargetRevokeResultV1",
      "owner": "ComputerTargetService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "WRITE_LOCAL_DATA",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "FEATURE_NOT_AVAILABLE",
        "PERMISSION_DENIED"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-05"
    }
  ]
} as const;

/** سجل عمليات Phase-06 (ADR-026)، كما هو على القرص. */
export const PHASE06_IPC_REGISTRY = {
  "contract_version": "1.6",
  "phase": "PHASE-06",
  "envelope_contract": "IPCEnvelopeV1",
  "implementation_status": "IMPLEMENTED",
  "operations": [
    {
      "operation": "connector.list",
      "envelope_version": "1.6",
      "request_schema": "desktop-p06-request.v1.schema.json#/$defs/ConnectorListRequestV1",
      "response_schema": "desktop-p06-result.v1.schema.json#/$defs/ConnectorListResultV1",
      "owner": "ConnectorService",
      "effect": "READ_ONLY",
      "effect_class": "READ",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-06"
    },
    {
      "operation": "connector.get",
      "envelope_version": "1.6",
      "request_schema": "desktop-p06-request.v1.schema.json#/$defs/ConnectorGetRequestV1",
      "response_schema": "desktop-p06-result.v1.schema.json#/$defs/ConnectorGetResultV1",
      "owner": "ConnectorService",
      "effect": "READ_ONLY",
      "effect_class": "READ",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-06"
    },
    {
      "operation": "connector.register",
      "envelope_version": "1.6",
      "request_schema": "desktop-p06-request.v1.schema.json#/$defs/ConnectorRegisterRequestV1",
      "response_schema": "desktop-p06-result.v1.schema.json#/$defs/ConnectorResultV1",
      "owner": "ConnectorService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "WRITE_CONFIG",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "FEATURE_NOT_AVAILABLE",
        "PERMISSION_DENIED"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-06"
    },
    {
      "operation": "connector.configure",
      "envelope_version": "1.6",
      "request_schema": "desktop-p06-request.v1.schema.json#/$defs/ConnectorConfigureRequestV1",
      "response_schema": "desktop-p06-result.v1.schema.json#/$defs/ConnectorResultV1",
      "owner": "ConnectorService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "WRITE_CONFIG",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "FEATURE_NOT_AVAILABLE",
        "PERMISSION_DENIED"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-06"
    },
    {
      "operation": "connector.remove",
      "envelope_version": "1.6",
      "request_schema": "desktop-p06-request.v1.schema.json#/$defs/ConnectorRemoveRequestV1",
      "response_schema": "desktop-p06-result.v1.schema.json#/$defs/ConnectorRemoveResultV1",
      "owner": "ConnectorService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "WRITE_CONFIG",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "FEATURE_NOT_AVAILABLE",
        "PERMISSION_DENIED"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-06"
    },
    {
      "operation": "connector.test",
      "envelope_version": "1.6",
      "request_schema": "desktop-p06-request.v1.schema.json#/$defs/ConnectorTestRequestV1",
      "response_schema": "desktop-p06-result.v1.schema.json#/$defs/ConnectorTestResultV1",
      "owner": "ConnectorHealthService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "NETWORK_PROBE",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "FEATURE_NOT_AVAILABLE",
        "PERMISSION_DENIED"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-06"
    },
    {
      "operation": "connector.credential.set",
      "envelope_version": "1.6",
      "request_schema": "desktop-p06-request.v1.schema.json#/$defs/ConnectorCredentialSetRequestV1",
      "response_schema": "desktop-p06-result.v1.schema.json#/$defs/ConnectorCredentialResultV1",
      "owner": "ConnectorSecretService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "SECRET_WRITE",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "FEATURE_NOT_AVAILABLE",
        "PERMISSION_DENIED"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-06"
    },
    {
      "operation": "connector.credential.clear",
      "envelope_version": "1.6",
      "request_schema": "desktop-p06-request.v1.schema.json#/$defs/ConnectorCredentialClearRequestV1",
      "response_schema": "desktop-p06-result.v1.schema.json#/$defs/ConnectorCredentialResultV1",
      "owner": "ConnectorSecretService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "SECRET_WRITE",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "FEATURE_NOT_AVAILABLE",
        "PERMISSION_DENIED"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-06"
    },
    {
      "operation": "connector.openapi.import",
      "envelope_version": "1.6",
      "request_schema": "desktop-p06-request.v1.schema.json#/$defs/ConnectorOpenapiImportRequestV1",
      "response_schema": "desktop-p06-result.v1.schema.json#/$defs/ConnectorOpenapiImportResultV1",
      "owner": "ConnectorImportService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "CREATE_LOCAL_DATA",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "FEATURE_NOT_AVAILABLE",
        "PERMISSION_DENIED"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-06"
    },
    {
      "operation": "connector.openapi.approve",
      "envelope_version": "1.6",
      "request_schema": "desktop-p06-request.v1.schema.json#/$defs/ConnectorOpenapiApproveRequestV1",
      "response_schema": "desktop-p06-result.v1.schema.json#/$defs/ConnectorResultV1",
      "owner": "ConnectorImportService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "WRITE_CONFIG",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "FEATURE_NOT_AVAILABLE",
        "PERMISSION_DENIED"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-06"
    },
    {
      "operation": "connector.preset.list",
      "envelope_version": "1.6",
      "request_schema": "desktop-p06-request.v1.schema.json#/$defs/ConnectorPresetListRequestV1",
      "response_schema": "desktop-p06-result.v1.schema.json#/$defs/ConnectorPresetListResultV1",
      "owner": "ConnectorService",
      "effect": "READ_ONLY",
      "effect_class": "READ",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-06"
    },
    {
      "operation": "connector.preset.register",
      "envelope_version": "1.6",
      "request_schema": "desktop-p06-request.v1.schema.json#/$defs/ConnectorPresetRegisterRequestV1",
      "response_schema": "desktop-p06-result.v1.schema.json#/$defs/ConnectorResultV1",
      "owner": "ConnectorService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "WRITE_CONFIG",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "FEATURE_NOT_AVAILABLE",
        "PERMISSION_DENIED"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-06"
    },
    {
      "operation": "usage.summary",
      "envelope_version": "1.6",
      "request_schema": "desktop-p06-request.v1.schema.json#/$defs/UsageSummaryRequestV1",
      "response_schema": "desktop-p06-result.v1.schema.json#/$defs/UsageSummaryResultV1",
      "owner": "UsageLedgerService",
      "effect": "READ_ONLY",
      "effect_class": "READ",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-06"
    },
    {
      "operation": "usage.list",
      "envelope_version": "1.6",
      "request_schema": "desktop-p06-request.v1.schema.json#/$defs/UsageListRequestV1",
      "response_schema": "desktop-p06-result.v1.schema.json#/$defs/UsageListResultV1",
      "owner": "UsageLedgerService",
      "effect": "READ_ONLY",
      "effect_class": "READ",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-06"
    },
    {
      "operation": "budget.list",
      "envelope_version": "1.6",
      "request_schema": "desktop-p06-request.v1.schema.json#/$defs/BudgetListRequestV1",
      "response_schema": "desktop-p06-result.v1.schema.json#/$defs/BudgetListResultV1",
      "owner": "BudgetService",
      "effect": "READ_ONLY",
      "effect_class": "READ",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-06"
    },
    {
      "operation": "budget.set",
      "envelope_version": "1.6",
      "request_schema": "desktop-p06-request.v1.schema.json#/$defs/BudgetSetRequestV1",
      "response_schema": "desktop-p06-result.v1.schema.json#/$defs/BudgetSetResultV1",
      "owner": "BudgetService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "WRITE_CONFIG",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "FEATURE_NOT_AVAILABLE",
        "PERMISSION_DENIED"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-06"
    },
    {
      "operation": "budget.remove",
      "envelope_version": "1.6",
      "request_schema": "desktop-p06-request.v1.schema.json#/$defs/BudgetRemoveRequestV1",
      "response_schema": "desktop-p06-result.v1.schema.json#/$defs/BudgetRemoveResultV1",
      "owner": "BudgetService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "WRITE_CONFIG",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "FEATURE_NOT_AVAILABLE",
        "PERMISSION_DENIED"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-06"
    },
    {
      "operation": "pricing.list",
      "envelope_version": "1.6",
      "request_schema": "desktop-p06-request.v1.schema.json#/$defs/PricingListRequestV1",
      "response_schema": "desktop-p06-result.v1.schema.json#/$defs/PricingListResultV1",
      "owner": "PricingService",
      "effect": "READ_ONLY",
      "effect_class": "READ",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-06"
    },
    {
      "operation": "pricing.set",
      "envelope_version": "1.6",
      "request_schema": "desktop-p06-request.v1.schema.json#/$defs/PricingSetRequestV1",
      "response_schema": "desktop-p06-result.v1.schema.json#/$defs/PricingSetResultV1",
      "owner": "PricingService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "WRITE_CONFIG",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "FEATURE_NOT_AVAILABLE",
        "PERMISSION_DENIED"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-06"
    },
    {
      "operation": "pricing.remove",
      "envelope_version": "1.6",
      "request_schema": "desktop-p06-request.v1.schema.json#/$defs/PricingRemoveRequestV1",
      "response_schema": "desktop-p06-result.v1.schema.json#/$defs/PricingRemoveResultV1",
      "owner": "PricingService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "WRITE_CONFIG",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "FEATURE_NOT_AVAILABLE",
        "PERMISSION_DENIED"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-06"
    },
    {
      "operation": "observability.health",
      "envelope_version": "1.6",
      "request_schema": "desktop-p06-request.v1.schema.json#/$defs/ObservabilityHealthRequestV1",
      "response_schema": "desktop-p06-result.v1.schema.json#/$defs/ObservabilityHealthResultV1",
      "owner": "ObservabilityService",
      "effect": "READ_ONLY",
      "effect_class": "READ",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-06"
    },
    {
      "operation": "observability.events",
      "envelope_version": "1.6",
      "request_schema": "desktop-p06-request.v1.schema.json#/$defs/ObservabilityEventsRequestV1",
      "response_schema": "desktop-p06-result.v1.schema.json#/$defs/ObservabilityEventsResultV1",
      "owner": "ObservabilityService",
      "effect": "READ_ONLY",
      "effect_class": "READ",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-06"
    },
    {
      "operation": "observability.metrics",
      "envelope_version": "1.6",
      "request_schema": "desktop-p06-request.v1.schema.json#/$defs/ObservabilityMetricsRequestV1",
      "response_schema": "desktop-p06-result.v1.schema.json#/$defs/ObservabilityMetricsResultV1",
      "owner": "ObservabilityService",
      "effect": "READ_ONLY",
      "effect_class": "READ",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-06"
    },
    {
      "operation": "observability.errors",
      "envelope_version": "1.6",
      "request_schema": "desktop-p06-request.v1.schema.json#/$defs/ObservabilityErrorsRequestV1",
      "response_schema": "desktop-p06-result.v1.schema.json#/$defs/ObservabilityErrorsResultV1",
      "owner": "ObservabilityService",
      "effect": "READ_ONLY",
      "effect_class": "READ",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-06"
    },
    {
      "operation": "observability.alerts",
      "envelope_version": "1.6",
      "request_schema": "desktop-p06-request.v1.schema.json#/$defs/ObservabilityAlertsRequestV1",
      "response_schema": "desktop-p06-result.v1.schema.json#/$defs/ObservabilityAlertsResultV1",
      "owner": "ObservabilityService",
      "effect": "READ_ONLY",
      "effect_class": "READ",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-06"
    },
    {
      "operation": "diagnostics.export",
      "envelope_version": "1.6",
      "request_schema": "desktop-p06-request.v1.schema.json#/$defs/DiagnosticsExportRequestV1",
      "response_schema": "desktop-p06-result.v1.schema.json#/$defs/DiagnosticsExportResultV1",
      "owner": "DiagnosticsService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "CREATE_LOCAL_DATA",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "FEATURE_NOT_AVAILABLE",
        "PERMISSION_DENIED"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-06"
    },
    {
      "operation": "config.describe",
      "envelope_version": "1.6",
      "request_schema": "desktop-p06-request.v1.schema.json#/$defs/ConfigDescribeRequestV1",
      "response_schema": "desktop-p06-result.v1.schema.json#/$defs/ConfigDescribeResultV1",
      "owner": "ConfigControlPlane",
      "effect": "READ_ONLY",
      "effect_class": "READ",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-06"
    },
    {
      "operation": "config.effective",
      "envelope_version": "1.6",
      "request_schema": "desktop-p06-request.v1.schema.json#/$defs/ConfigEffectiveRequestV1",
      "response_schema": "desktop-p06-result.v1.schema.json#/$defs/ConfigEffectiveResultV1",
      "owner": "ConfigControlPlane",
      "effect": "READ_ONLY",
      "effect_class": "READ",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-06"
    },
    {
      "operation": "config.set",
      "envelope_version": "1.6",
      "request_schema": "desktop-p06-request.v1.schema.json#/$defs/ConfigSetRequestV1",
      "response_schema": "desktop-p06-result.v1.schema.json#/$defs/ConfigSetResultV1",
      "owner": "ConfigControlPlane",
      "effect": "SIDE_EFFECTING",
      "effect_class": "WRITE_CONFIG",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "FEATURE_NOT_AVAILABLE",
        "PERMISSION_DENIED"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-06"
    },
    {
      "operation": "config.reset",
      "envelope_version": "1.6",
      "request_schema": "desktop-p06-request.v1.schema.json#/$defs/ConfigResetRequestV1",
      "response_schema": "desktop-p06-result.v1.schema.json#/$defs/ConfigResetResultV1",
      "owner": "ConfigControlPlane",
      "effect": "SIDE_EFFECTING",
      "effect_class": "WRITE_CONFIG",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "FEATURE_NOT_AVAILABLE",
        "PERMISSION_DENIED"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-06"
    }
  ]
} as const;

/** سجل Phase-08 (ADR-028). ملف سابع منفصل: السجلات السابقة لا تُحرَّر. */
export const PHASE08_IPC_REGISTRY = {
  "contract_version": "1.7",
  "phase": "PHASE-08",
  "envelope_contract": "IPCEnvelopeV1",
  "implementation_status": "IMPLEMENTED",
  "operations": [
    {
      "operation": "workspace.list",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/WorkspaceListRequestV1",
      "response_schema": "desktop-p08-result.v1.schema.json#/$defs/WorkspaceListResultV1",
      "owner": "WorkspaceService",
      "effect": "READ_ONLY",
      "effect_class": "READ",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    },
    {
      "operation": "workspace.preview",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/WorkspacePreviewRequestV1",
      "response_schema": "desktop-p08-result.v1.schema.json#/$defs/WorkspacePreviewResultV1",
      "owner": "WorkspaceService",
      "effect": "READ_ONLY",
      "effect_class": "READ_RESOURCE",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    },
    {
      "operation": "workspace.export",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/WorkspaceExportRequestV1",
      "response_schema": "desktop-p08-result.v1.schema.json#/$defs/WorkspaceExportResultV1",
      "owner": "WorkspaceService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "WRITE_LOCAL_DATA",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    },
    {
      "operation": "attachment.stage",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/AttachmentStageRequestV1",
      "response_schema": "desktop-p08-result.v1.schema.json#/$defs/AttachmentStageResultV1",
      "owner": "AttachmentService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "CREATE_LOCAL_DATA",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    },
    {
      "operation": "attachment.discard",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/AttachmentDiscardRequestV1",
      "response_schema": "desktop-p08-result.v1.schema.json#/$defs/AttachmentDiscardResultV1",
      "owner": "AttachmentService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "WRITE_LOCAL_DATA",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    },
    {
      "operation": "attachment.artifact.stage",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/AttachmentArtifactStageRequestV1",
      "response_schema": "desktop-p08-result.v1.schema.json#/$defs/AttachmentStageResultV1",
      "owner": "AttachmentService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "CREATE_LOCAL_DATA",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    },
    {
      "operation": "attachment.list",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/AttachmentListRequestV1",
      "response_schema": "desktop-p08-result.v1.schema.json#/$defs/AttachmentListResultV1",
      "owner": "AttachmentService",
      "effect": "READ_ONLY",
      "effect_class": "READ",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    },
    {
      "operation": "attachment.bind",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/AttachmentBindRequestV1",
      "response_schema": "desktop-p08-result.v1.schema.json#/$defs/AttachmentBindResultV1",
      "owner": "AttachmentService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "WRITE_LOCAL_DATA",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    },
    {
      "operation": "artifact.list",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/ArtifactListRequestV1",
      "response_schema": "desktop-p08-result.v1.schema.json#/$defs/ArtifactListResultV1",
      "owner": "ArtifactService",
      "effect": "READ_ONLY",
      "effect_class": "READ",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    },
    {
      "operation": "artifact.get",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/ArtifactGetRequestV1",
      "response_schema": "desktop-p08-result.v1.schema.json#/$defs/ArtifactGetResultV1",
      "owner": "ArtifactService",
      "effect": "READ_ONLY",
      "effect_class": "READ",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    },
    {
      "operation": "execution.status",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/ExecutionStatusRequestV1",
      "response_schema": "desktop-p08-result.v1.schema.json#/$defs/ExecutionStatusResultV1",
      "owner": "ExecutionService",
      "effect": "READ_ONLY",
      "effect_class": "READ",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    },
    {
      "operation": "execution.runs",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/ExecutionRunsRequestV1",
      "response_schema": "desktop-p08-result.v1.schema.json#/$defs/ExecutionRunsResultV1",
      "owner": "ExecutionService",
      "effect": "READ_ONLY",
      "effect_class": "READ",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    },
    {
      "operation": "execution.runtime.prepare",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/ExecutionRuntimePrepareRequestV1",
      "response_schema": "desktop-p08-result.v1.schema.json#/$defs/ExecutionRuntimePrepareResultV1",
      "owner": "ExecutionService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "CREATE_LOCAL_DATA",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    },
    {
      "operation": "mission.model.set",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/MissionModelSetRequestV1",
      "response_schema": "desktop-p08-result.v1.schema.json#/$defs/MissionModelSetResultV1",
      "owner": "MissionPreferenceService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "WRITE_CONFIG",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    },
    {
      "operation": "schedule.list",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/ScheduleListRequestV1",
      "response_schema": "desktop-p08-result.v1.schema.json#/$defs/ScheduleListResultV1",
      "owner": "SchedulerService",
      "effect": "READ_ONLY",
      "effect_class": "READ",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    },
    {
      "operation": "schedule.save",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/ScheduleSaveRequestV1",
      "response_schema": "desktop-p08-result.v1.schema.json#/$defs/ScheduleSaveResultV1",
      "owner": "SchedulerService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "WRITE_CONFIG",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    },
    {
      "operation": "schedule.enable",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/ScheduleEnableRequestV1",
      "response_schema": "desktop-p08-result.v1.schema.json#/$defs/ScheduleEnableResultV1",
      "owner": "SchedulerService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "WRITE_CONFIG",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    },
    {
      "operation": "schedule.delete",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/ScheduleDeleteRequestV1",
      "response_schema": "desktop-p08-result.v1.schema.json#/$defs/ScheduleDeleteResultV1",
      "owner": "SchedulerService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "WRITE_CONFIG",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    },
    {
      "operation": "schedule.run_now",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/ScheduleRunNowRequestV1",
      "response_schema": "desktop-p08-result.v1.schema.json#/$defs/ScheduleRunNowResultV1",
      "owner": "SchedulerService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "CONTROL",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    },
    {
      "operation": "oauth.list",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/OauthListRequestV1",
      "response_schema": "desktop-p08-result.v1.schema.json#/$defs/OauthListResultV1",
      "owner": "OAuthService",
      "effect": "READ_ONLY",
      "effect_class": "READ",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    },
    {
      "operation": "oauth.connect",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/OauthConnectRequestV1",
      "response_schema": "desktop-p08-result.v1.schema.json#/$defs/OauthConnectResultV1",
      "owner": "OAuthService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "SECRET_WRITE",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    },
    {
      "operation": "oauth.disconnect",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/OauthDisconnectRequestV1",
      "response_schema": "desktop-p08-result.v1.schema.json#/$defs/OauthDisconnectResultV1",
      "owner": "OAuthService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "SECRET_WRITE",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    },
    {
      "operation": "voice.transcribe",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/VoiceTranscribeRequestV1",
      "response_schema": "desktop-p08-result.v1.schema.json#/$defs/VoiceTranscribeResultV1",
      "owner": "VoiceService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "MODEL_INVOCATION",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    },
    {
      "operation": "share.list",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/ShareListRequestV1",
      "response_schema": "desktop-p08-result.v1.schema.json#/$defs/ShareListResultV1",
      "owner": "ShareService",
      "effect": "READ_ONLY",
      "effect_class": "READ",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    },
    {
      "operation": "share.set",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/ShareSetRequestV1",
      "response_schema": "desktop-p08-result.v1.schema.json#/$defs/ShareSetResultV1",
      "owner": "ShareService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "WRITE_CONFIG",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    },
    {
      "operation": "publish.list",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/PublishListRequestV1",
      "response_schema": "desktop-p08-result.v1.schema.json#/$defs/PublishListResultV1",
      "owner": "PublishService",
      "effect": "READ_ONLY",
      "effect_class": "READ",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    },
    {
      "operation": "publish.propose",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/PublishProposeRequestV1",
      "response_schema": "desktop-p08-result.v1.schema.json#/$defs/PublishProposeResultV1",
      "owner": "PublishService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "CREATE_LOCAL_DATA",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    },
    {
      "operation": "publish.decide",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/PublishDecideRequestV1",
      "response_schema": "desktop-p08-result.v1.schema.json#/$defs/PublishDecideResultV1",
      "owner": "PublishService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "CONTROL",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    },
    {
      "operation": "skill.package.list",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/SkillPackageListRequestV1",
      "response_schema": "desktop-p08-result.v1.schema.json#/$defs/SkillPackageListResultV1",
      "owner": "SkillPackageService",
      "effect": "READ_ONLY",
      "effect_class": "READ",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    },
    {
      "operation": "skill.package.import",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/SkillPackageImportRequestV1",
      "response_schema": "desktop-p08-result.v1.schema.json#/$defs/SkillPackageImportResultV1",
      "owner": "SkillPackageService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "CREATE_LOCAL_DATA",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    },
    {
      "operation": "device.export",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/DeviceExportRequestV1",
      "response_schema": "desktop-p08-result.v1.schema.json#/$defs/DeviceExportResultV1",
      "owner": "DeviceService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "WRITE_LOCAL_DATA",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    },
    {
      "operation": "device.import",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/DeviceImportRequestV1",
      "response_schema": "desktop-p08-result.v1.schema.json#/$defs/DeviceImportResultV1",
      "owner": "DeviceService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "CREATE_LOCAL_DATA",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    },
    {
      "operation": "integration.settings.set",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/IntegrationSettingsSetRequestV1",
      "response_schema": "desktop-p08-result.v1.schema.json#/$defs/IntegrationSettingsSetResultV1",
      "owner": "IntegrationSettingsService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "WRITE_CONFIG",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    },
    {
      "operation": "conversation.begin",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/ConversationBeginRequestV1",
      "response_schema": "desktop-p08-result.v1.schema.json#/$defs/ConversationBeginResultV1",
      "owner": "ConversationService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "WRITE_LOCAL_DATA",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    },
    {
      "operation": "conversation.continue",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/ConversationContinueRequestV1",
      "response_schema": "desktop-p08-result.v1.schema.json#/$defs/ConversationContinueResultV1",
      "owner": "ConversationService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "CREATE_LOCAL_DATA",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    },
    {
      "operation": "conversation.get",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/ConversationGetRequestV1",
      "response_schema": "desktop-p08-result.v1.schema.json#/$defs/ConversationGetResultV1",
      "owner": "ConversationService",
      "effect": "READ_ONLY",
      "effect_class": "READ",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    },
    {
      "operation": "conversation.index",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/ConversationIndexRequestV1",
      "response_schema": "desktop-p08-result.v1.schema.json#/$defs/ConversationIndexResultV1",
      "owner": "ConversationService",
      "effect": "READ_ONLY",
      "effect_class": "READ",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    },
    {
      "operation": "agent.catalog",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/AgentCatalogRequestV1",
      "response_schema": "desktop-p08-result.v1.schema.json#/$defs/AgentCatalogResultV1",
      "owner": "SpecialistCatalogService",
      "effect": "READ_ONLY",
      "effect_class": "READ",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    },
    {
      "operation": "mission.specialist.set",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/MissionSpecialistSetRequestV1",
      "response_schema": "desktop-p08-result.v1.schema.json#/$defs/MissionSpecialistSetResultV1",
      "owner": "MissionPreferenceService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "WRITE_CONFIG",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    },
    {
      "operation": "conversation.update",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/ConversationUpdateRequestV1",
      "response_schema": "desktop-p08-result.v1.schema.json#/$defs/ConversationUpdateResultV1",
      "owner": "ConversationService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "WRITE_LOCAL_DATA",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    },
    {
      "operation": "conversation.delete",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/ConversationDeleteRequestV1",
      "response_schema": "desktop-p08-result.v1.schema.json#/$defs/ConversationDeleteResultV1",
      "owner": "ConversationService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "WRITE_LOCAL_DATA",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    },
    {
      "operation": "project.delete",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/ProjectDeleteRequestV1",
      "response_schema": "desktop-p08-result.v1.schema.json#/$defs/ProjectDeleteResultV1",
      "owner": "ProjectService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "WRITE_LOCAL_DATA",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    },
    {
      "operation": "memory.remember",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/MemoryRememberRequestV1",
      "response_schema": "desktop-p08-result.v1.schema.json#/$defs/MemoryRememberResultV1",
      "owner": "MemoryService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "CREATE_LOCAL_DATA",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    },
    {
      "operation": "conversation.search",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/ConversationSearchRequestV1",
      "response_schema": "desktop-p08-result.v1.schema.json#/$defs/ConversationSearchResultV1",
      "owner": "ConversationService",
      "effect": "READ_ONLY",
      "effect_class": "READ",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    },
    {
      "operation": "mission.trace",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/MissionTraceRequestV1",
      "response_schema": "desktop-p08-result.v1.schema.json#/$defs/MissionTraceResultV1",
      "owner": "ObservabilityService",
      "effect": "READ_ONLY",
      "effect_class": "READ",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    },
    {
      "operation": "mcp.tool.accept_redefinition",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/McpAcceptRedefinitionRequestV1",
      "response_schema": "desktop-p08-result.v1.schema.json#/$defs/McpAcceptRedefinitionResultV1",
      "owner": "McpDiscoveryService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "WRITE_CONFIG",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    },
    {
      "operation": "provider.catalog",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/ProviderCatalogRequestV1",
      "response_schema": "desktop-p08-result.v1.schema.json#/$defs/ProviderCatalogResultV1",
      "owner": "ProviderRegistryService",
      "effect": "READ_ONLY",
      "effect_class": "READ",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    },
    {
      "operation": "provider.credential.put",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/ProviderCredentialPutRequestV1",
      "response_schema": "desktop-p02-result.v1.schema.json#/$defs/ProviderCredentialResultV1",
      "owner": "SecretBrokerService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "SECRET_WRITE",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    },
    {
      "operation": "provider.custom.save",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/ProviderCustomSaveRequestV1",
      "response_schema": "desktop-p02-result.v1.schema.json#/$defs/ProviderConfigureResultV1",
      "owner": "ProviderConfigService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "WRITE_CONFIG",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    },
    {
      "operation": "provider.custom.delete",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/ProviderCustomDeleteRequestV1",
      "response_schema": "desktop-p08-result.v1.schema.json#/$defs/ProviderCustomDeleteResultV1",
      "owner": "ProviderConfigService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "WRITE_CONFIG",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    },
    {
      "operation": "web.search.status",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/WebSearchStatusRequestV1",
      "response_schema": "desktop-p08-result.v1.schema.json#/$defs/WebSearchStatusResultV1",
      "owner": "WebSearchService",
      "effect": "READ_ONLY",
      "effect_class": "READ",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    },
    {
      "operation": "web.search.credential.put",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/WebSearchCredentialPutRequestV1",
      "response_schema": "desktop-p08-result.v1.schema.json#/$defs/WebSearchStatusResultV1",
      "owner": "WebSearchService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "SECRET_WRITE",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    },
    {
      "operation": "web.search.test",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/WebSearchTestRequestV1",
      "response_schema": "desktop-p08-result.v1.schema.json#/$defs/WebSearchTestResultV1",
      "owner": "WebSearchService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "NETWORK_PROBE",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    },
    {
      "operation": "mission.rating.set",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/MissionRatingSetRequestV1",
      "response_schema": "desktop-p08-result.v1.schema.json#/$defs/MissionRatingResultV1",
      "owner": "ConversationService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "WRITE_LOCAL_DATA",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    },
    {
      "operation": "mission.note.add",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/MissionNoteAddRequestV1",
      "response_schema": "desktop-p08-result.v1.schema.json#/$defs/MissionNoteResultV1",
      "owner": "ConversationService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "CREATE_LOCAL_DATA",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    },
    {
      "operation": "tool.approval.grants",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/ToolApprovalGrantsRequestV1",
      "response_schema": "desktop-p08-result.v1.schema.json#/$defs/ToolApprovalGrantsResultV1",
      "owner": "ToolApprovalService",
      "effect": "READ_ONLY",
      "effect_class": "READ",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    },
    {
      "operation": "tool.approval.grant.revoke",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/ToolApprovalGrantRevokeRequestV1",
      "response_schema": "desktop-p08-result.v1.schema.json#/$defs/ToolApprovalGrantRevokeResultV1",
      "owner": "ToolApprovalService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "CONTROL",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    },
    {
      "operation": "github.status",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/GitHubStatusRequestV1",
      "response_schema": "desktop-p08-result.v1.schema.json#/$defs/GitHubStatusResultV1",
      "owner": "GitHubConnectorService",
      "effect": "READ_ONLY",
      "effect_class": "READ",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    },
    {
      "operation": "github.connect",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/GitHubConnectRequestV1",
      "response_schema": "desktop-p08-result.v1.schema.json#/$defs/GitHubStatusResultV1",
      "owner": "GitHubConnectorService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "SECRET_WRITE",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    },
    {
      "operation": "github.disconnect",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/GitHubDisconnectRequestV1",
      "response_schema": "desktop-p08-result.v1.schema.json#/$defs/GitHubStatusResultV1",
      "owner": "GitHubConnectorService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "SECRET_WRITE",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    },
    {
      "operation": "memory.semantic.status",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/MemorySemanticStatusRequestV1",
      "response_schema": "desktop-p08-result.v1.schema.json#/$defs/MemorySemanticStatusResultV1",
      "owner": "IntegrationSettingsService",
      "effect": "READ_ONLY",
      "effect_class": "READ",
      "idempotency": "NOT_REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    },
    {
      "operation": "memory.semantic.set",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/MemorySemanticSetRequestV1",
      "response_schema": "desktop-p08-result.v1.schema.json#/$defs/MemorySemanticStatusResultV1",
      "owner": "IntegrationSettingsService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "WRITE_CONFIG",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    },
    {
      "operation": "memory.semantic.test",
      "envelope_version": "1.7",
      "request_schema": "desktop-p08-request.v1.schema.json#/$defs/MemorySemanticTestRequestV1",
      "response_schema": "desktop-p08-result.v1.schema.json#/$defs/MemorySemanticTestResultV1",
      "owner": "IntegrationSettingsService",
      "effect": "SIDE_EFFECTING",
      "effect_class": "NETWORK_PROBE",
      "idempotency": "REQUIRED",
      "trust_boundary": "RENDERER_TO_NATIVE_HOST",
      "caller_class": "DESKTOP_RENDERER",
      "caller_identity_authority": "NATIVE_TRANSPORT",
      "error_categories": [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "PERMISSION_DENIED",
        "FEATURE_NOT_AVAILABLE"
      ],
      "availability": {
        "state": "AVAILABLE"
      },
      "routing_status": "ROUTED",
      "phase_introduced": "PHASE-08"
    }
  ]
} as const;

/** خريطة تصنيف الأخطاء، كما هي على القرص. */
export const ERROR_MAPPING = {
  "contract_version": "1.0",
  "phase": "PHASE-01",
  "entries": [
    {
      "category": "IPC_TIMEOUT",
      "canonical_codes": [
        "TIMEOUT"
      ],
      "retryable": true,
      "detail_may_cross_boundary": false,
      "default_redaction": "STRIP_ALL_DETAIL",
      "display_key": "desktop.error.ipc_timeout"
    },
    {
      "category": "NATIVE_SERVICE_UNAVAILABLE",
      "canonical_codes": [
        "DEPENDENCY_UNAVAILABLE"
      ],
      "retryable": true,
      "detail_may_cross_boundary": false,
      "default_redaction": "STRIP_ALL_DETAIL",
      "display_key": "desktop.error.native_service_unavailable"
    },
    {
      "category": "IPC_UNAVAILABLE",
      "canonical_codes": [
        "DEPENDENCY_UNAVAILABLE"
      ],
      "retryable": true,
      "detail_may_cross_boundary": false,
      "default_redaction": "STRIP_ALL_DETAIL",
      "display_key": "desktop.error.ipc_unavailable"
    },
    {
      "category": "UNSUPPORTED_OPERATION",
      "canonical_codes": [
        "UNSUPPORTED_VERSION",
        "CONTRACT_VIOLATION"
      ],
      "retryable": false,
      "detail_may_cross_boundary": false,
      "default_redaction": "STRIP_INTERNAL_DETAIL",
      "display_key": "desktop.error.unsupported_operation"
    },
    {
      "category": "INVALID_RESPONSE",
      "canonical_codes": [
        "MALFORMED_MESSAGE",
        "VALIDATION_ERROR",
        "CONTRACT_VIOLATION"
      ],
      "retryable": false,
      "detail_may_cross_boundary": false,
      "default_redaction": "STRIP_INTERNAL_DETAIL",
      "display_key": "desktop.error.invalid_response"
    },
    {
      "category": "PERMISSION_DENIED",
      "canonical_codes": [
        "POLICY_DENIED"
      ],
      "retryable": false,
      "detail_may_cross_boundary": false,
      "default_redaction": "STRIP_ALL_DETAIL",
      "display_key": "desktop.error.permission_denied"
    },
    {
      "category": "FEATURE_NOT_AVAILABLE",
      "canonical_codes": [
        "POLICY_DENIED",
        "DEPENDENCY_UNAVAILABLE"
      ],
      "retryable": false,
      "detail_may_cross_boundary": false,
      "default_redaction": "STRIP_ALL_DETAIL",
      "display_key": "desktop.error.feature_not_available"
    },
    {
      "category": "CONFIG_UNAVAILABLE",
      "canonical_codes": [
        "DEPENDENCY_UNAVAILABLE",
        "CONFLICT"
      ],
      "retryable": true,
      "detail_may_cross_boundary": false,
      "default_redaction": "STRIP_ALL_DETAIL",
      "display_key": "desktop.error.config_unavailable"
    },
    {
      "category": "INTERNAL_ERROR",
      "canonical_codes": [
        "INTERNAL_ERROR",
        "CONFLICT"
      ],
      "retryable": false,
      "detail_may_cross_boundary": false,
      "default_redaction": "STRIP_ALL_DETAIL",
      "display_key": "desktop.error.internal_error"
    }
  ]
} as const;
