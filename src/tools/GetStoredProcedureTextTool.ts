import sql from "mssql";
import { Tool } from "@modelcontextprotocol/sdk/types.js";


export class GetStoredProcedureTextTool implements Tool {
  [key: string]: any;
  name = "get_stored_procedure_text";
  description = "Gets the text of a specified MSSQL Database stored procedure.";
  inputSchema = {
    type: "object",
    properties: {
      storedProcName: { type: "string", description: "Name of the stored procedure to get its text" },
    },
    required: ["storedProcName"],
  } as any;

  async run(params: { storedProcName: string }) {
    try {
      const { storedProcName } = params;
      const request = new sql.Request();
      const query = `SELECT object_definition(object_id) FROM sys.procedures WHERE name = @storedProcName`;
      request.input("storedProcName", sql.NVarChar, storedProcName);
      const result = await request.query(query);
      return {
        success: true,
        text: result.recordset[0],
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to get stored procedure text: ${error}`,
      };
    }
  }
}
