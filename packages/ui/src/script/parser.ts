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
  type: 'number' | 'boolean' | 'string' | 'entity' | 'action'
  value: number | boolean | string | ActionRef
  optional?: boolean
}

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
  }
  return { type: 'string', value: '' }
}

function getValueAndTypeFromType(typeAnnotation: TSTypeAnnotation['typeAnnotation']): ScriptParam {
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
      }
      break
    case 'TSUnionType': // (e.g: string | undefined) — first non-undefined type wins
      for (const subType of typeAnnotation.types) {
        if (subType.type !== 'TSUndefinedKeyword') {
          return getValueAndTypeFromType(subType)
        }
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

    // "public param: Type" (constructor parameter property)
    if (param.type === 'TSParameterProperty') {
      const parameter = param.parameter
      if (parameter.type === 'Identifier') {
        identifier = parameter
        optional = identifier.optional === true
        if (identifier.typeAnnotation?.type === 'TSTypeAnnotation') {
          ;({ type, value } = getValueAndTypeFromType(identifier.typeAnnotation.typeAnnotation))
        }
      } else if (parameter.type === 'AssignmentPattern' && parameter.left.type === 'Identifier') {
        identifier = parameter.left
        optional = true
        // with a type annotation (e.g. "target: Entity = 512"), type comes from
        // the annotation and the default value from the expression
        const typeAnnotation = identifier.typeAnnotation
        if (typeAnnotation?.type === 'TSTypeAnnotation') {
          type = getValueAndTypeFromType(typeAnnotation.typeAnnotation).type
          value = getValueAndTypeFromExpression(parameter.right).value
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
        type = getValueAndTypeFromType(typeAnnotation.typeAnnotation).type
        value = getValueAndTypeFromExpression(param.right).value
      } else {
        ;({ type, value } = getValueAndTypeFromExpression(param.right))
      }
    } else if (param.type === 'Identifier') {
      identifier = param
      optional = identifier.optional === true
      if (identifier.typeAnnotation?.type === 'TSTypeAnnotation') {
        ;({ type, value } = getValueAndTypeFromType(identifier.typeAnnotation.typeAnnotation))
      }
    }

    if (identifier === undefined) return
    result[identifier.name] = { type, optional, value } as ScriptParam
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

export function parseLayout(layout?: string): ScriptLayout | undefined {
  if (layout === undefined || layout === '') return undefined
  try {
    return JSON.parse(layout) as ScriptLayout
  } catch (error) {
    console.warn('Failed to parse script layout:', error)
    return undefined
  }
}

// Re-parse merge: keep freshly parsed types/defaults (source), preserve the
// user's edited values (target) for params whose name+type still match.
export function mergeLayout(source: ScriptLayout, target: ScriptLayout): ScriptLayout {
  const layout: ScriptLayout = { params: {}, actions: [] }
  for (const [name, value] of Object.entries(source.params)) {
    const targetParam = target.params[name]
    if (targetParam === undefined || value.type !== targetParam.type) {
      layout.params[name] = value
    } else {
      layout.params[name] = { ...value, ...targetParam }
    }
  }
  layout.actions = source.actions
  layout.error = source.error
  return layout
}
