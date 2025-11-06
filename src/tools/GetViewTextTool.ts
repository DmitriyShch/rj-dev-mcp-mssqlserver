import sql from "mssql";
import { Tool } from "@modelcontextprotocol/sdk/types.js";

type GetViewTextParams = {
  viewName: string;
  schemaName?: string;
  startLine?: number;
  lineCount?: number;
  startChar?: number;
};

type GetViewTextResult = {
  success: true;
  viewName: string;
  schemaName?: string;
  startLine: number;
  lineCount: number;
  startChar: number;
  endChar: number;
  totalChars: number;
  totalLines: number;
  hasMore: boolean;
  nextStartLine: number | null;
  nextStartChar: number | null;
  maxCharsPerChunk: number;
  charLimited: boolean;
  text: string;
};

type GetViewTextError = {
  success: false;
  message: string;
};

const MAX_CHARS_PER_CHUNK = 8_000;

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

export class GetViewTextTool implements Tool {
  [key: string]: any;
  name = "get_view_text";
  description = "Gets the text of a specified MSSQL Database view. Supports optional schema and paging.";
  inputSchema = {
    type: "object",
    properties: {
      viewName: { type: "string", description: "Name of the view to get its text" },
      schemaName: { type: "string", description: "Optional schema name (defaults to current user schema)" },
      startLine: {
        type: "integer",
        minimum: 1,
        description: "1-based line number to start from (defaults to 1)",
      },
      lineCount: {
        type: "integer",
        minimum: 1,
        description: "Maximum number of lines to return starting at startLine",
      },
      startChar: {
        type: "integer",
        minimum: 1,
        description: "1-based character offset to start from (overrides startLine if provided)",
      },
    },
    required: ["viewName"],
  } as any;

  async run(params: GetViewTextParams): Promise<GetViewTextResult | GetViewTextError> {
    try {
      const { viewName, schemaName, startLine, lineCount, startChar } = params;

      const request = new sql.Request();
      request.input("viewName", sql.NVarChar, viewName);
      if (schemaName) {
        request.input("schemaName", sql.NVarChar, schemaName);
      }

      const query = `
        SELECT sm.definition
        FROM sys.sql_modules AS sm
        INNER JOIN sys.views AS v ON sm.object_id = v.object_id
        INNER JOIN sys.schemas AS s ON v.schema_id = s.schema_id
        WHERE v.name = @viewName
          ${schemaName ? "AND s.name = @schemaName" : ""}
      `;

      const result = await request.query<{ definition: string }>(query);
      const record = result.recordset[0];

      if (!record?.definition) {
        return {
          success: false,
          message: schemaName
            ? `View ${schemaName}.${viewName} was not found.`
            : `View ${viewName} was not found.`,
        };
      }

      const normalizedText = record.definition.replace(/\r\n/g, "\n");
      const totalChars = normalizedText.length;

      if (totalChars === 0) {
        return {
          success: true,
          viewName,
          schemaName,
          startLine: 0,
          lineCount: 0,
          startChar: 1,
          endChar: 0,
          totalChars: 0,
          totalLines: 0,
          hasMore: false,
          nextStartLine: null,
          nextStartChar: null,
          maxCharsPerChunk: MAX_CHARS_PER_CHUNK,
          charLimited: false,
          text: "",
        };
      }

      const lineStartIndices: number[] = [0];
      for (let i = 0; i < totalChars; i += 1) {
        if (normalizedText.charCodeAt(i) === 10) {
          lineStartIndices.push(i + 1);
        }
      }
      lineStartIndices.push(totalChars);
      const totalLines = lineStartIndices.length - 1;

      const resolvedStartChar =
        typeof startChar === "number" && Number.isFinite(startChar) ? Math.floor(startChar) : null;

      if (resolvedStartChar && resolvedStartChar > totalChars) {
        const emptyStartLine = totalLines + 1;
        return {
          success: true,
          viewName,
          schemaName,
          startLine: emptyStartLine,
          lineCount: 0,
          startChar: totalChars + 1,
          endChar: totalChars,
          totalChars,
          totalLines,
          hasMore: false,
          nextStartLine: null,
          nextStartChar: null,
          maxCharsPerChunk: MAX_CHARS_PER_CHUNK,
          charLimited: false,
          text: "",
        };
      }

      let startCharIndex: number;
      if (resolvedStartChar && resolvedStartChar > 0) {
        startCharIndex = clamp(resolvedStartChar - 1, 0, totalChars - 1);
      } else if (typeof startLine === "number" && Number.isFinite(startLine) && startLine > 0) {
        const clampedLine = clamp(Math.floor(startLine), 1, totalLines);
        startCharIndex = lineStartIndices[clampedLine - 1];
      } else {
        startCharIndex = 0;
      }

      let startLineIndex = 0;
      while (startLineIndex + 1 < lineStartIndices.length && lineStartIndices[startLineIndex + 1] <= startCharIndex) {
        startLineIndex += 1;
      }
      const effectiveStartLine = startLineIndex + 1;

      const resolvedLineCount =
        typeof lineCount === "number" && Number.isFinite(lineCount) && lineCount > 0 ? Math.floor(lineCount) : null;

      let requestedEndByLines = totalChars;
      if (resolvedLineCount && totalLines > 0) {
        const exclusiveLineNumber = Math.min(effectiveStartLine + resolvedLineCount, totalLines + 1);
        requestedEndByLines = lineStartIndices[exclusiveLineNumber - 1];
      }

      let endCharExclusive = Math.min(requestedEndByLines, startCharIndex + MAX_CHARS_PER_CHUNK);
      if (endCharExclusive < startCharIndex) {
        endCharExclusive = startCharIndex;
      }
      if (endCharExclusive === startCharIndex && startCharIndex < totalChars) {
        endCharExclusive = Math.min(startCharIndex + MAX_CHARS_PER_CHUNK, totalChars);
      }

      const charLimitApplied = endCharExclusive < requestedEndByLines;
      const text = normalizedText.slice(startCharIndex, endCharExclusive);

      let actualLineCount = 0;
      let atLineStart = true;
      for (let i = 0; i < text.length; i += 1) {
        if (atLineStart) {
          actualLineCount += 1;
          atLineStart = false;
        }
        if (text.charCodeAt(i) === 10) {
          atLineStart = true;
        }
      }
      if (text.length === 0) {
        actualLineCount = 0;
      }

      const hasMore = endCharExclusive < totalChars;

      let nextStartLine: number | null = null;
      if (hasMore) {
        let lineIndexForEnd = 0;
        while (lineIndexForEnd + 1 < lineStartIndices.length && lineStartIndices[lineIndexForEnd + 1] <= endCharExclusive) {
          lineIndexForEnd += 1;
        }
        nextStartLine = lineIndexForEnd + 1;
      }

      return {
        success: true,
        viewName,
        schemaName,
        startLine: effectiveStartLine,
        lineCount: actualLineCount,
        startChar: startCharIndex + 1,
        endChar: endCharExclusive,
        totalChars,
        totalLines,
        hasMore,
        nextStartLine,
        nextStartChar: hasMore ? endCharExclusive + 1 : null,
        maxCharsPerChunk: MAX_CHARS_PER_CHUNK,
        charLimited: charLimitApplied,
        text,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to get view text: ${error}`,
      };
    }
  }
}
