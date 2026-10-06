'use strict'

const CONTENT_RECOGNITION_PROMPT = `识别图中内容。这是一张工厂的“包装指令单 / 生产包装指令”类单据（含头部批号信息、产品/产量表、备注、过敏原与打印标记、包装要求、包装材料清单表格）。
请提取以下信息并以 JSON 格式返回：
{
  "raw_text": "原始识别的所有文本内容（按版面顺序完整转录，包含表格内每一格文字）",
  "structured_info": {
    "document_title": "单据标题，例如：包装指令单（瓶装）",
    "form_code": "右上角的单据/模板编号，例如 PDRExxxxx",
    "order_no": "订单号",
    "production_batch_no": "生产批号",
    "packing_batch_no": "包装批号",
    "planned_quantity": "计划批量（含单位，例如 1000.00瓶）",
    "production_date": "生产日期（保持原始数字格式，例如 20260812）",
    "production_workshop": "生产车间（例如 301 车间）",
    "expiry_date": "有效期至（保持原始数字格式）",
    "po_no": "PO号（若无则 null，斜杠 / 也按原样记录）",
    "products": [{
      "order_no": "订单编号",
      "product_code": "产品编码",
      "product_name": "产品名称（含口味等括号说明）",
      "packing_spec": "包装规格(件)，例如 APDD-FoYes-1.8kg/瓶 *4瓶/箱",
      "planned_output_wan": "计划产量-万片(粒)",
      "planned_output_bottle": "计划产量-瓶",
      "planned_output_case": "计划产量-件"
    }],
    "remarks": ["备注区每条说明（如取样说明、净含量检测要求等），逐条列出"],
    "barcode_value": "备注区内条形码下方的字符序列",
    "allergen_marking": ["过敏原标记，逐项列出"],
    "packing_requirements": ["包装要求的每一条编号说明，逐条列出（保留 LOT/MFG 等喷码内容）"],
    "packing_materials": [{
      "seq": "序号",
      "material_code": "物料编号",
      "material_name": "物料名称",
      "spec_model": "规格型号（含尺寸、工艺、颜色等描述）",
      "material_version": "版本号",
      "unit": "计量单位"
    }]
  }
}
请注意：
如果某个字段无法识别或不存在，请设置为 null（不是空字符串）。
raw_text 必须包含图中所有能识别出的文本，包括表格中每一格的文字、条码字符、二维码旁编号等。
products 与 packing_materials 为表格数据，请逐行提取为数组；同一物料若跨多行展示（如名称行 + 规格行），请合并到同一对象中。
数量、日期、批号等数值与编码必须原样保留，不要补零、截断或转换格式（例如 20260812、1800.00、APDD26X1006、1314001002-1）。
保持原始文字的完整性，包括中英文混合内容、全角/半角符号及特殊符号（如 ≥、×、*、()、-、/ 等）。
过敏原、包装要求等可能含多项，请以字符串数组形式逐条返回，不要把多条合并成一行。
structured_info 各字段应尽可能准确地归类，不要把包装要求误填入备注，也不要把打印批号与生产批号混淆。
确保 JSON 格式完全正确，所有键与字符串值均使用 ASCII 双引号包围，末尾无多余逗号。
只输出一个 JSON 对象，不要输出 Markdown 代码块或额外解释。`

const BOM_PROMPT = '本次用于产品 BOM 录入。重点核对表头产品编码、产品名称、完整包装规格及包装材料清单。产品编码是 10 位数字，不能将批号、订单号或物料编号当作产品编码。物料编号必须保留连字符、跨行后缀与前导零；材料版本号和计量单位应原样提取。多页合并同一清单，重叠拍摄的相同行只保留一次，编号相同但规格不同的行须保留。模糊或被裁切的内容填 null，禁止猜测。保持主模板的 raw_text / structured_info JSON 格式。'

const ORDER_PROMPT = '本次用于生产订单录入。订单号与生产批号分别提取，禁止把喷码批号当作生产批号。计划产量-件与计划产量-瓶分别原样记录，不在原始字段中换算。补充提取 structured_info.sample_count：取样说明中明确列出的成品、精密、菌检、留样数量之和；任何取样行看不清或被裁切时填 null，禁止猜测。包装规格保留净重和每箱数量，物料清单保留版本号、计量单位、连字符与跨行后缀。保持主模板的 raw_text / structured_info JSON 格式。'

module.exports = { CONTENT_RECOGNITION_PROMPT, BOM_PROMPT, ORDER_PROMPT }
