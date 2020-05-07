import {
  Visitor,
  namedTypes as n,
  builders as b,
} from 'ast-types'
import { ExpressionKind } from 'ast-types/gen/kinds'

// use `globalThis` instead of `window`, `self`... to lower chances of scope conflict
// users can technically override even this, but it would be very rude
// "[globalThis] provides a way for polyfills/shims, build tools, and portable code to have a reliable non-eval means to access the global..."
// @see https://github.com/tc39/proposal-global/blob/master/NAMING.md
const globalIdentifier = b.identifier('globalThis')

/**
 * Generate a CallExpression for Cypress.resolveWindowReference
 * @param accessedObject object being accessed
 * @param prop name of property being accessed
 * @param maybeVal if an assignment is being made, this is the RHS of the assignment
 */
function resolveWindowReference (accessedObject: ExpressionKind, prop: string, maybeVal?: ExpressionKind) {
  const args = [
    globalIdentifier,
    accessedObject,
    b.stringLiteral(prop),
  ]

  if (maybeVal) {
    args.push(maybeVal)
  }

  return b.callExpression(
    b.memberExpression(
      b.memberExpression(
        b.memberExpression(
          globalIdentifier,
          b.identifier('top'),
        ),
        b.identifier('Cypress'),
      ),
      b.identifier('resolveWindowReference'),
    ),
    args,
  )
}

/**
 * Generate a CallExpression for Cypress.resolveLocationReference
 * @param accessedObject object being accessed
 * @param prop name of property being accessed
 * @param maybeVal if an assignment is being made, this is the RHS of the assignment
 */
function resolveLocationReference () {
  return b.callExpression(
    b.memberExpression(
      b.memberExpression(
        b.memberExpression(
          globalIdentifier,
          b.identifier('top'),
        ),
        b.identifier('Cypress'),
      ),
      b.identifier('resolveLocationReference'),
    ),
    [globalIdentifier],
  )
}

/**
 * Given an Identifier or a Literal, return a property name that should use `resolveWindowReference`.
 * @param node
 */
function getReplaceablePropOfMemberExpression (node: n.MemberExpression) {
  const { property } = node

  // something.(top|parent)
  if (n.Identifier.check(property) && ['parent', 'top', 'location', 'frames'].includes(property.name)) {
    return property.name
  }

  // something['(top|parent)']
  if (n.Literal.check(property) && ['parent', 'top', 'location', 'frames'].includes(String(property.value))) {
    return String(property.value)
  }

  // NOTE: cases where a variable is used for the prop will not be replaced
  // for example, `bar = 'top'; window[bar];` will not be replaced
  // this would most likely be too slow

  return
}

/**
 * An AST Visitor that applies JS transformations required for Cypress.
 * @see https://github.com/benjamn/ast-types#ast-traversal for details on how the Visitor is implemented
 * @see https://astexplorer.net/#/gist/7f1e645c74df845b0e1f814454e9bbdf/f443b701b53bf17fbbf40e9285cb8b65a4066240
 *  to explore ASTs generated by recast
 */
export const jsRules: Visitor<{}> = {
  // replace member accesses like foo['top'] or bar.parent with resolveWindowReference
  visitMemberExpression (path) {
    const { node } = path

    const prop = getReplaceablePropOfMemberExpression(node)

    if (!prop) {
      return this.traverse(path)
    }

    path.replace(resolveWindowReference(path.get('object').node, prop))

    return false
  },
  // replace lone identifiers like `top`, `parent`, with resolveWindowReference
  visitIdentifier (path) {
    const { node } = path

    if (path.parentPath) {
      const parentNode = path.parentPath.node

      // like `identifer = 'foo'`
      const isAssignee = n.AssignmentExpression.check(parentNode) && parentNode.left === node

      if (isAssignee && node.name === 'location') {
        // `location = 'something'`, rewrite to intercepted href setter since relative urls can break this
        return path.replace(b.memberExpression(resolveLocationReference(), b.identifier('href')))
      }

      // some Identifiers do not refer to a scoped variable, depending on how they're used
      if (
        // like `var top = 'foo'`
        (n.VariableDeclarator.check(parentNode) && parentNode.id === node)
        || (isAssignee)
        || (
          [
            'LabeledStatement', // like `top: foo();`
            'ContinueStatement', // like 'continue top'
            'BreakStatement', // like 'break top'
            'Property', // like `{ top: 'foo' }`
            'FunctionDeclaration', // like `function top()`
            'RestElement', // like (...top)
            'ArrowFunctionExpression', // like `(top, ...parent) => { }`
            'ArrowExpression', // MDN Parser docs mention this being used for () => {}
            'FunctionExpression', // like `(function top())`,
          ].includes(parentNode.type)
        )
      ) {
        return false
      }
    }

    if (path.scope.declares(node.name)) {
      // identifier has been declared in local scope, don't care about replacing
      return this.traverse(path)
    }

    if (node.name === 'location') {
      path.replace(resolveLocationReference())

      return false
    }

    if (['parent', 'top', 'frames'].includes(node.name)) {
      path.replace(resolveWindowReference(globalIdentifier, node.name))

      return false
    }

    this.traverse(path)
  },
  visitAssignmentExpression (path) {
    const { node } = path

    const finish = () => {
      this.traverse(path)
    }

    if (!n.MemberExpression.check(node.left)) {
      return finish()
    }

    const propBeingSet = getReplaceablePropOfMemberExpression(node.left)

    if (!propBeingSet) {
      return finish()
    }

    if (node.operator !== '=') {
      // in the case of +=, -=, |=, etc., assume they're not doing something like
      // `window.top += 4` since that would be invalid anyways, just continue down the RHS
      this.traverse(path.get('right'))

      return false
    }

    const objBeingSetOn = node.left.object

    path.replace(resolveWindowReference(objBeingSetOn, propBeingSet, node.right))

    return false
  },
}
