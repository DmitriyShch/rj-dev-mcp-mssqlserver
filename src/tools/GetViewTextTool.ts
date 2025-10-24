import sql from "mssql";
import { Tool } from "@modelcontextprotocol/sdk/types.js";


export class GetViewTextTool implements Tool {
  [key: string]: any;
  name = "get_view_text";
  description = "Gets the text of a specified MSSQL Database view.";
  inputSchema = {
    type: "object",
    properties: {
      viewName: { type: "string", description: "Name of the view to get its text" },
    },
    required: ["viewName"],
  } as any;

  async run(params: { viewName: string }) {
    try {
      const { viewName } = params;
      const request = new sql.Request();
      const query = `SELECT object_definition(object_id) FROM sys.views WHERE name = @viewName`;
      request.input("viewName", sql.NVarChar, viewName);
      const result = await request.query(query);
      return {
        success: true,
        text: result.recordset[0],
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to get view text: ${error}`,
      };
    }
  }
}
