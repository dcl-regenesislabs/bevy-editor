// Parses a script's constructor (or `export function start`) signature into the
// typed param layout the Script inspector renders — the same contract the
// Creator Hub uses. Ported from @dcl/inspector's ScriptInspector/parser.ts
// (recovered from the published bundle's sourcemap; the npm dist ships only
// type declarations). Kept behavior-identical so layouts round-trip between
// this editor and the Creator Hub, minus the @dcl/ecs import (RootEntity = 0).
import { parse } from '@babel/parser'
import type {
  ClassMethod,
  Expression,
  Identifier,
  TSParameterProperty,
  TSTypeAnnotation
} from '@babel/types'

type FunctionParameter = ClassMethod['params'][number]

export type ActionRef = { entity: number; action: string }

export type ScriptParam = {
  type: 'number' | 'boolean' | 'string' | 'entity' | 'action' | 'enum' | 'prefab' | 'prefabList'
  value: number | boolean | string | string[] | ActionRef
  optional?: boolean
  // for 'enum': the string-literal union members, in declaration order
  options?: string[]
  // the param's JSDoc line, carried into the layout so the inspector can show it
  description?: string
}

// `PrefabRef` (and `PrefabRef[]`, the only array param type in v1) is a
// deliberate, documented fork from Creator Hub parser parity: the generated
// src/scripts/spawnables.ts exports it as a branded string, scripts annotate a
// param with it, and the inspector renders a picker over Spawnable prefabs
// instead of a text field. The value stored is the prefab's UUID.
const PREFAB_REF = 'PrefabRef'
const ARRAY_TYPES = ['Array', 'ReadonlyArray']

export type ScriptAction = {
  methodName: string
  description?: string
  params: Record<string, ScriptParam>
}

export type ScriptLayout = {
  params: Record<string, ScriptParam>
  actions?: ScriptAction[]
  error?: string
}

const ROOT_ENTITY = 0

function getValueAndTypeFromExpression(expression: Expression): ScriptParam {
  switch (expression.type) {
    case 'NumericLiteral':
      return { type: 'number', value: expression.value }
    case 'BooleanLiteral':
      return { type: 'boolean', value: expression.value }
    case 'StringLiteral':
      return { type: 'string', value: expression.value }
    // `clickable: Entity = 0 as Entity` — `Entity` is a branded number, so the
    // only way to write its default is a cast. Without unwrapping it the default
    // falls through to '' and an `entity` param ships holding a string, which no
    // runtime compare against an entity id can ever match.
    case 'TSAsExpression':
      return getValueAndTypeFromExpression(expression.expression)
  }
  return { type: 'string', value: '' }
}

// A default read through an already-known annotated type: `arenas: PrefabRef[] = []`
// must stay a list, and the scalar path above would flatten it to ''.
function defaultValueFor(type: ScriptParam['type'], expression: Expression): ScriptParam['value'] {
  if (type !== 'prefabList') return getValueAndTypeFromExpression(expression).value
  if (expression.type !== 'ArrayExpression') return []
  const refs: string[] = []
  for (const element of expression.elements) {
    if (element !== null && element.type === 'StringLiteral') refs.push(element.value)
  }
  return refs
}

function isPrefabRefType(typeAnnotation: TSTypeAnnotation['typeAnnotation']): boolean {
  return (
    typeAnnotation.type === 'TSTypeReference' &&
    typeAnnotation.typeName.type === 'Identifier' &&
    typeAnnotation.typeName.name === PREFAB_REF
  )
}

// `PrefabRef[]` and `Array<PrefabRef>` — the same param, written two ways.
function isPrefabRefList(typeAnnotation: TSTypeAnnotation['typeAnnotation']): boolean {
  if (typeAnnotation.type === 'TSArrayType') return isPrefabRefType(typeAnnotation.elementType)
  if (
    typeAnnotation.type === 'TSTypeReference' &&
    typeAnnotation.typeName.type === 'Identifier' &&
    ARRAY_TYPES.includes(typeAnnotation.typeName.name)
  ) {
    const args = typeAnnotation.typeParameters?.params
    return args !== undefined && args.length === 1 && isPrefabRefType(args[0])
  }
  return false
}

function getValueAndTypeFromType(typeAnnotation: TSTypeAnnotation['typeAnnotation']): ScriptParam {
  if (isPrefabRefList(typeAnnotation)) return { type: 'prefabList', value: [] }
  switch (typeAnnotation.type) {
    case 'TSNumberKeyword':
      return { type: 'number', value: 0 }
    case 'TSBooleanKeyword':
      return { type: 'boolean', value: false }
    case 'TSTypeReference':
      if (typeAnnotation.typeName.type === 'Identifier') {
        if (typeAnnotation.typeName.name === 'Entity') {
          return { type: 'entity', value: ROOT_ENTITY }
        }
        if (typeAnnotation.typeName.name === 'ActionCallback') {
          return { type: 'action', value: { entity: ROOT_ENTITY, action: '' } }
        }
        if (typeAnnotation.typeName.name === PREFAB_REF) {
          return { type: 'prefab', value: '' }
        }
      }
      break
    case 'TSUnionType': {
      // a union of string literals ("'3D text' | '2D UI'") is an enum: render
      // as a dropdown of exactly those choices
      const literals: string[] = []
      let allLiterals = true
      for (const subType of typeAnnotation.types) {
        if (subType.type === 'TSUndefinedKeyword') continue
        if (subType.type === 'TSLiteralType' && subType.literal.type === 'StringLiteral') {
          literals.push(subType.literal.value)
        } else {
          allLiterals = false
        }
      }
      if (allLiterals && literals.length > 0) {
        return { type: 'enum', value: literals[0], options: literals }
      }
      // otherwise (e.g. string | undefined) — first non-undefined type wins
      for (const subType of typeAnnotation.types) {
        if (subType.type !== 'TSUndefinedKeyword') {
          return getValueAndTypeFromType(subType)
        }
      }
      break
    }
  }
  return { type: 'string', value: '' }
}

function getIdentifier(param: FunctionParameter | TSParameterProperty): Identifier | undefined {
  if (param.type === 'Identifier') {
    return param
  } else if (param.type === 'TSParameterProperty' && param.parameter.type === 'Identifier') {
    return param.parameter
  }
  return undefined
}

function assertScriptSignature(params: (FunctionParameter | TSParameterProperty)[]): void {
  const first = getIdentifier(params[0])
  if (
    first === undefined ||
    first.typeAnnotation?.type !== 'TSTypeAnnotation' ||
    first.typeAnnotation.typeAnnotation.type !== 'TSStringKeyword'
  ) {
    throw new Error('First parameter must be "src: string"')
  }
  const second = getIdentifier(params[1])
  if (
    second === undefined ||
    second.typeAnnotation?.type !== 'TSTypeAnnotation' ||
    second.typeAnnotation.typeAnnotation.type !== 'TSTypeReference' ||
    second.typeAnnotation.typeAnnotation.typeName.type !== 'Identifier' ||
    second.typeAnnotation.typeAnnotation.typeName.name !== 'Entity'
  ) {
    throw new Error('Second parameter must be "entity: Entity"')
  }
}

function extractJSDocDescription(
  comments?: { type: string; value: string }[] | null
): string | undefined {
  if (comments == null) return undefined
  for (const comment of comments) {
    if (comment.type === 'CommentBlock') {
      const lines = comment.value.split('\n').map((line) => line.trim().replace(/^\*\s?/, ''))
      const descriptionLines: string[] = []
      for (const line of lines) {
        if (line.startsWith('@')) break // stop at first @tag
        if (line.length > 0) descriptionLines.push(line)
      }
      const description = descriptionLines.join(' ').trim()
      return description.length > 0 ? description : undefined
    }
  }
  return undefined
}

function extractParamsFromFunctionParams(
  params: (FunctionParameter | TSParameterProperty)[]
): Record<string, ScriptParam> {
  const result: Record<string, ScriptParam> = {}

  params.forEach((param) => {
    let identifier: Identifier | undefined
    let optional = false
    let type: ScriptParam['type'] = 'string'
    let value: ScriptParam['value'] = ''
    let options: string[] | undefined

    // "public param: Type" (constructor parameter property)
    if (param.type === 'TSParameterProperty') {
      const parameter = param.parameter
      if (parameter.type === 'Identifier') {
        identifier = parameter
        optional = identifier.optional === true
        if (identifier.typeAnnotation?.type === 'TSTypeAnnotation') {
          ;({ type, value, options } = getValueAndTypeFromType(identifier.typeAnnotation.typeAnnotation))
        }
      } else if (parameter.type === 'AssignmentPattern' && parameter.left.type === 'Identifier') {
        identifier = parameter.left
        optional = true
        // with a type annotation (e.g. "target: Entity = 512"), type comes from
        // the annotation and the default value from the expression
        const typeAnnotation = identifier.typeAnnotation
        if (typeAnnotation?.type === 'TSTypeAnnotation') {
          ;({ type, options } = getValueAndTypeFromType(typeAnnotation.typeAnnotation))
          value = defaultValueFor(type, parameter.right)
        } else {
          ;({ type, value } = getValueAndTypeFromExpression(parameter.right))
        }
      }
    }
    // plain function parameters
    else if (param.type === 'AssignmentPattern' && param.left.type === 'Identifier') {
      identifier = param.left
      optional = true
      const typeAnnotation = identifier.typeAnnotation
      if (typeAnnotation?.type === 'TSTypeAnnotation') {
        ;({ type, options } = getValueAndTypeFromType(typeAnnotation.typeAnnotation))
        value = defaultValueFor(type, param.right)
      } else {
        ;({ type, value } = getValueAndTypeFromExpression(param.right))
      }
    } else if (param.type === 'Identifier') {
      identifier = param
      optional = identifier.optional === true
      if (identifier.typeAnnotation?.type === 'TSTypeAnnotation') {
        ;({ type, value, options } = getValueAndTypeFromType(identifier.typeAnnotation.typeAnnotation))
      }
    }

    if (identifier === undefined) return
    const description = extractJSDocDescription(param.leadingComments)
    result[identifier.name] = {
      type,
      optional,
      value,
      ...(options !== undefined ? { options } : {}),
      ...(description !== undefined ? { description } : {})
    } as ScriptParam
  })

  return result
}

export type ScriptParseResult = {
  params: Record<string, ScriptParam>
  actions: ScriptAction[]
  error?: string
}

export function getScriptParams(content: string): ScriptParseResult {
  let params: Record<string, ScriptParam> = {}
  const actions: ScriptAction[] = []

  try {
    const ast = parse(content, { sourceType: 'module', plugins: ['typescript', 'jsx'] })

    for (const statement of ast.program.body) {
      // function-based scripts: export function start(src: string, entity: Entity, ...)
      if (
        statement.type === 'ExportNamedDeclaration' &&
        statement.declaration?.type === 'FunctionDeclaration' &&
        statement.declaration.id?.name === 'start'
      ) {
        assertScriptSignature(statement.declaration.params)
        params = extractParamsFromFunctionParams(statement.declaration.params.slice(2))
        break
      }

      // class-based scripts: export class MyScript { constructor(src, entity, ...) }
      if (
        statement.type === 'ExportNamedDeclaration' &&
        statement.declaration?.type === 'ClassDeclaration'
      ) {
        const classDeclaration = statement.declaration
        const constructor = classDeclaration.body.body.find(
          (member): member is ClassMethod =>
            member.type === 'ClassMethod' && member.kind === 'constructor'
        )
        if (constructor !== undefined) {
          assertScriptSignature(constructor.params)
          params = extractParamsFromFunctionParams(constructor.params.slice(2))
        }

        // @action-tagged methods (kept for Creator Hub layout compatibility)
        for (const member of classDeclaration.body.body) {
          if (member.type === 'ClassMethod' && member.kind === 'method') {
            const leadingComments = member.leadingComments
            const hasActionTag = leadingComments?.some(
              (comment) => comment.type === 'CommentBlock' && comment.value.includes('@action')
            )
            if (hasActionTag === true && member.key.type === 'Identifier') {
              actions.push({
                methodName: member.key.name,
                description: extractJSDocDescription(leadingComments),
                params: extractParamsFromFunctionParams(member.params)
              })
            }
          }
        }
        break
      }
    }

    return { params, actions }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : ''
    console.warn('Failed to parse script params:', error)
    return { params, actions, error: errorMessage }
  }
}

// The layout string a Script component entry carries, parsed fresh from source.
export function freshLayout(content: string): string {
  const { params, actions, error } = getScriptParams(content)
  const layout: ScriptLayout = { params, actions, error }
  return JSON.stringify(layout)
}

export function parseLayout(layout?: string): ScriptLayout | undefined {
  if (layout === undefined || layout === '') return undefined
  try {
    return JSON.parse(layout) as ScriptLayout
  } catch (error) {
    console.warn('Failed to parse script layout:', error)
    return undefined
  }
}

const ENTITY_MARKER = /^\{entity:\d+\}$/

// Does a stored value still fit the freshly parsed param? The runner passes
// layout values positionally into the constructor and its defaults only cover
// `undefined`, so a value that stopped fitting must fall back to the fresh
// default here — it would otherwise reach the script as-is.
function valueFits(param: ScriptParam, value: ScriptParam['value']): boolean {
  switch (param.type) {
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'string':
    case 'prefab':
      return typeof value === 'string'
    case 'enum':
      return typeof value === 'string' && (param.options ?? []).includes(value)
    case 'entity':
      // folder composites hold `{entity:<localId>}` markers where a placed
      // instance holds an engine id — both are that param's honest shape
      return (
        (typeof value === 'number' && Number.isFinite(value)) ||
        (typeof value === 'string' && ENTITY_MARKER.test(value))
      )
    case 'action':
      return typeof value === 'object' && value !== null && !Array.isArray(value)
    case 'prefabList':
      return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
  }
}

// Re-parse merge: the fresh parse (source) is authoritative for everything a
// script declares — params, order, types, defaults, options, optionality, doc
// lines. The stored layout (target) contributes exactly one thing: the edited
// VALUE, kept only while the fresh param would still accept it. A param the
// script dropped vanishes; one it added appears with its default; a value whose
// type no longer matches, whose enum option was removed, or whose stored shape
// is wrong falls back to the fresh default.
export function mergeLayout(source: ScriptLayout, target: ScriptLayout): ScriptLayout {
  const layout: ScriptLayout = { params: {}, actions: [] }
  for (const [name, value] of Object.entries(source.params)) {
    const targetParam = target.params[name]
    if (
      targetParam === undefined ||
      value.type !== targetParam.type ||
      !valueFits(value, targetParam.value)
    ) {
      layout.params[name] = value
    } else {
      layout.params[name] = { ...value, value: targetParam.value }
    }
  }
  layout.actions = source.actions
  layout.error = source.error
  return layout
}
