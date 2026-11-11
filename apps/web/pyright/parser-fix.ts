/** @file parser-fix.ts @description Applies the numeric attribute recovery fix to upstream Pyright. @module editor */
const trailerEnd = `                    this._maxChildDepthMap.set(memberAccessNode.id, maxDepth + 1);
                }
            } else {
                break;
            }
`;

const numberTrailer = `                    this._maxChildDepthMap.set(memberAccessNode.id, maxDepth + 1);
                }
            } else if (
                startOfTrailerToken.type === TokenType.Number &&
                this._fileContents[startOfTrailerToken.start] === '.'
            ) {
                // A dot followed by digits is tokenized as a number. Consume it so
                // enclosing expressions can still find their closing delimiters.
                this._addSyntaxError(LocMessage.expectedMemberName(), startOfTrailerToken);
                this._getNextToken();
            } else {
                break;
            }
`;

/** Apply exactly once so Pyright upgrades surface changes to the parser. */
export function fixNumericAttributeRecovery(parser: string) {
  const position = parser.indexOf(trailerEnd);
  if (position === -1 || position !== parser.lastIndexOf(trailerEnd)) {
    throw new Error("Cannot apply numeric attribute recovery fix to this Pyright parser");
  }
  return parser.replace(trailerEnd, numberTrailer);
}
