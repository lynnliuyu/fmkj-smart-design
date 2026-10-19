#!/usr/bin/env python3
"""Build two reusable, Chinese-safe PDF templates and synthetic previews.

Chinese text is rendered from the source layout with embedded fonts. PdfCraft
handles named image fields and preserves interactive picture slots. No database
is read or written. Generated files are isolated from project deliveries.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen.canvas import Canvas

ROOT = Path(__file__).resolve().parents[2]
SPECS = ROOT / "docs/templates/pdf"
WORK = ROOT / "tmp/pdfs/fmkj-templates"
OUT = ROOT / "output/pdf/templates-v1"
SPEC = json.loads((SPECS / "template-spec.v1.json").read_text())
PAL = {key: colors.HexColor(value) for key, value in SPEC["palette"].items()}
COMPANY = SPEC["companyName"]
LOGO = ROOT / SPEC["logo"]
DEFAULT_CLI = Path.home() / "Downloads/pdfcraft-cli-0.6.0-macos-universal/pdfcraft-cli"
M = 38


def register_fonts():
    for name, candidates in {
        "CN": ["/System/Library/Fonts/STHeiti Light.ttc", "/System/Library/Fonts/Supplemental/Arial Unicode.ttf"],
        "CNBold": ["/System/Library/Fonts/STHeiti Medium.ttc", "/System/Library/Fonts/Supplemental/Arial Unicode.ttf"],
    }.items():
        for candidate in candidates:
            if Path(candidate).is_file():
                pdfmetrics.registerFont(TTFont(name, candidate, subfontIndex=0))
                break
        else:
            raise RuntimeError("缺少可嵌入中文字体，请配置本机字体后生成。")


def money(value):
    return f"¥{Decimal(str(value)).quantize(Decimal('.01'), rounding=ROUND_HALF_UP):,.2f}"


def wrap(text, width, size, font="CN"):
    lines = []
    for paragraph in str(text).split("\n"):
        line = ""
        for ch in paragraph:
            if line and pdfmetrics.stringWidth(line + ch, font, size) > width:
                lines.append(line)
                line = ch
            else:
                line += ch
        lines.append(line)
    return lines


class Page:
    def __init__(self, canvas, size, page, kind, sample, slots):
        self.c, self.w, self.h = canvas, size[0], size[1]
        self.index, self.kind, self.sample, self.slots = page, kind, sample, slots
        canvas.setPageSize(size)
        canvas.setFillColor(colors.white)
        canvas.rect(0, 0, self.w, self.h, fill=1, stroke=0)

    def text(self, value, x, top, size=10, color="ink", bold=False, align="left"):
        self.c.setFillColor(PAL[color])
        self.c.setFont("CNBold" if bold else "CN", size)
        getattr(self.c, {"left": "drawString", "right": "drawRightString", "center": "drawCentredString"}[align])(x, self.h-top-size, str(value))

    def line(self, x0, y0, x1, y1, color="line", width=.6):
        self.c.setStrokeColor(PAL[color])
        self.c.setLineWidth(width)
        self.c.line(x0, self.h-y0, x1, self.h-y1)

    def box(self, x, y, w, h, fill="wash", stroke=False):
        self.c.setFillColor(PAL[fill])
        self.c.setStrokeColor(PAL["line"])
        self.c.setLineWidth(.5)
        self.c.rect(x, self.h-y-h, w, h, fill=1, stroke=stroke)

    def paragraph(self, value, x, top, width, size=10, leading=16, max_lines=None, color="ink", bold=False):
        lines = wrap(value, width, size, "CNBold" if bold else "CN")
        if max_lines and len(lines) > max_lines:
            raise ValueError(f"{self.kind} 第{self.index}页内容超框：{str(value)[:50]}")
        for i, line in enumerate(lines):
            self.text(line, x, top+i*leading, size, color, bold)
        return len(lines)*leading

    def slot(self, key, value, rect, size=11, bold=False, max_lines=1, align="left"):
        x, y, w, h = rect
        self.slots.append({"name": key, "kind": "source-text", "page": self.index, "rect": [x,y,x+w,y+h], "fontSize": size, "maxLines": max_lines})
        color = "ink" if self.sample else "muted"
        if max_lines > 1:
            self.paragraph(value, x, y, w, size, size*1.4, max_lines, color, bold)
        else:
            if pdfmetrics.stringWidth(str(value), "CNBold" if bold else "CN", size) > w:
                raise ValueError(f"字段 {key} 超出宽度，请换行或调整版式")
            self.text(value, x+w if align=="right" else x+w/2 if align=="center" else x, y, size, color, bold, align)

    def image_slot(self, key, rect, source=None):
        x,y,w,h = rect
        self.slots.append({"name":key,"pdfFieldName":key.replace(".","_"),"kind":"pdfcraft-image","page":self.index,"rect":[x,y,x+w,y+h],"sampleImage":str(source) if source else None})

    def header(self, section, no):
        self.c.setFont("Helvetica-Bold", 9)
        self.c.setFillColor(PAL["accent"])
        self.c.drawString(M, self.h-48, "FMKJ")
        self.text(COMPANY, M+39, 32, 13, bold=True)
        self.text(section, self.w-M, 34, 9, "muted", align="right")
        self.line(M, 73, self.w-M, 73)
        self.line(M, self.h-35, self.w-M, self.h-35)
        self.text("模拟套用 / 非客户方案或报价" if self.sample else "模板母版 / V1", M, self.h-27, 7.5, "muted")
        self.text(f"{no:02d}", self.w-M, self.h-27, 8, "muted", align="right")

    def end(self):
        self.c.showPage()


def make_diagram():
    """Synthetic technical plan: no customer geometry or product photographs."""
    path = WORK / "synthetic-floorplan.pdf"
    c = Canvas(str(path), pagesize=(1100, 650))
    p = Page(c, (1100,650), 1, "synthetic-plan", True, [])
    walls=[(80,75,940,75),(80,575,940,575),(80,75,80,575),(940,75,940,575),
           (80,310,350,310),(350,75,350,230),(350,275,350,575),
           (690,75,690,290),(690,340,690,575),(690,310,940,310)]
    for x0,y0,x1,y1 in walls:p.line(x0,y0,x1,y1,"ink",8)
    p.box(90,85,250,215,"wash")
    p.box(700,85,230,215,"wash")
    p.box(700,320,230,245,"wash")
    p.box(90,320,250,245,"wash")
    for x,y,w,h in [(125,140,170,125),(735,140,160,125),(735,390,150,145)]:
        p.c.setFillColor(colors.white);p.c.setStrokeColor(PAL["line"]);p.c.rect(x,p.h-y-h,w,h,fill=1,stroke=1)
        p.line(x,y+30,x+w,y+30)
    p.box(115,360,190,43,"line")
    p.box(115,420,46,110,"line")
    p.box(455,390,150,60,"wash",True)
    p.box(455,450,55,65,"wash",True)
    p.c.setStrokeColor(PAL["line"]);p.c.setFillColor(PAL["wash"])
    p.c.circle(520,650-230,55,fill=1,stroke=1)
    for x,y,name in [(160,105,"次卧"),(755,105,"主卧"),(760,345,"书房"),(160,335,"厨房"),(480,128,"餐厅"),(480,535,"客厅")]:p.text(name,x,y,15,"muted")
    markers=[(345,275,"双开","accent"),(360,323,"三开","accent"),(690,335,"双开","accent"),(705,285,"三开","accent"),(520,350,"AP","accent"),(865,285,"窗帘","muted"),(275,288,"窗帘","muted"),(815,545,"窗帘","muted")]
    for x,y,label,color in markers:
        p.c.setStrokeColor(PAL[color]);p.c.setFillColor(colors.white);p.c.setLineWidth(1)
        p.c.circle(x,650-y,17,stroke=1,fill=1)
        p.text(label,x,y-6,10,color,align="center")
    p.text("模拟平面 / 仅演示整图放入模板后的排版",550,610,12,"muted",align="center")
    c.save()
    subprocess.run(["pdftoppm","-singlefile","-r","120","-png",str(path),str(WORK/"synthetic-floorplan")],check=True,capture_output=True)
    return WORK/"synthetic-floorplan.png"


def placeholder_images():
    result = {}
    for label in ["开关","窗帘","网络","中控","网关","传感器","服务","其他"]:
        dest=WORK/f"image-placeholder-{label}.pdf"
        c=Canvas(str(dest),pagesize=(90,90));p=Page(c,(90,90),1,"placeholder",True,[])
        p.box(0,0,90,90,"wash");p.box(21,15,48,43,"wash",True)
        p.line(35,24,35,49,"accent",1.5);p.line(45,24,45,49,"accent",1.5);p.line(55,24,55,49,"accent",1.5)
        p.text(label,45,65,12,"muted",align="center");c.save()
        subprocess.run(["pdftoppm","-singlefile","-r","96","-png",str(dest),str(dest.with_suffix(""))],check=True,capture_output=True)
        result[label]=dest.with_suffix(".png")
    return result


def project_value(data, sample, key, placeholder):
    return str(data["project"].get(key,placeholder)) if sample else placeholder


def proposal(data, sample, floor_image):
    slots=[]; bg=WORK/("proposal-preview-base.pdf" if sample else "proposal-master-base.pdf")
    c=Canvas(str(bg),pagesize=A4);c.setTitle(f"{COMPANY} / 设计方案模板 V1");c.setAuthor(COMPANY)
    p=Page(c,A4,1,"proposal-overview",sample,slots);p.header("DESIGN PROPOSAL",1)
    p.text("全屋智能设计方案",M,104,27,bold=True)
    p.text("空间里的每个动作，都有合适的回应。",M,146,11,"muted")
    p.slot("project.name",project_value(data,sample,"name","项目名称"),(M,192,519,66),24,True,2)
    meta=[("客户","customer","客户姓名"),("项目地址","address","项目地址"),("方案编号","code","项目编号"),("方案版本","version","方案版本")]
    for i,(label,key,default) in enumerate(meta):
        y=285+i*44;p.text(label,M,y,9,"muted");p.slot(f"project.{key}",project_value(data,sample,key,default),(M+90,y-1,429,35),11,max_lines=2);p.line(M,y+34,p.w-M,y+34)
    p.text("本次设计范围",M,486,15,bold=True)
    scope=[("01","灯光与开关","根据空间动线梳理控制位置、灯组与使用需求。"),("02","窗帘控制","明确窗帘位置与联动需求，电源和轨道条件另行核对。"),("03","全屋网络","规划接入点与设备位置，结合现场条件复核覆盖。")]
    for i,(num,title,description) in enumerate(scope):
        y=526+i*66;p.text(num,M,y,10,"accent",True);p.text(title,M+35,y-1,12,bold=True);p.paragraph(description,M+35,y+23,480,9,14,2,"muted")
    p.slot("project.date",project_value(data,sample,"date","出具日期"),(M,749,300,20),9)
    p.slot("project.designer",project_value(data,sample,"designer","设计师 / 待填写"),(340,749,217,20),9,align="right")
    p.end()
    floors=data.get("floors",[{}]) if sample else [{}]
    for fi,floor in enumerate(floors):
        p=Page(c,landscape(A4),fi+2,"proposal-floorplan",sample,slots);p.header("点位与空间",fi+2)
        p.slot(f"floors.{fi}.name",str(floor.get("name","全屋")) if sample else "楼层 / 图纸名称",(M,90,400,30),19,True)
        p.text("一张图，一个页面",p.w-M,99,9,"muted",align="right")
        frame=(M,139,p.w-2*M,373);p.box(*frame,"wash",True)
        if not sample:p.text("完整点位图将在此按原比例放入",p.w/2,307,15,"muted",align="center")
        p.image_slot(f"proposal.floor.{fi+1:03}.image",frame,floor_image if sample else None)
        slots[-1]["sourcePath"]=f"floors[{fi}].imageSlot"
        p.text("点位类别、编号与图例随图片一并保留。",M,528,9,"muted")
        p.text("模拟图 / 非客户户型" if sample else "图片占位框",p.w-M,528,9,"muted",align="right");p.end()
    scenes=data.get("scenes",[])
    per_page=SPEC["proposal"]["scenesPerPage"]
    batches=[scenes[i:i+per_page] for i in range(0,len(scenes),per_page)] if sample else [[]]
    if not batches:batches=[[]]
    defaults=[("回家场景","入口按键 / App","进入空间时开启约定照明。"),("就餐场景","餐厅按键 / App","按客户习惯设置就餐照明。"),("就寝场景","床头按键 / App","按客户习惯设置灯光与窗帘动作。"),("离家场景","入口按键 / App","关闭指定灯光；网络设备保持供电。")]
    for bi,batch in enumerate(batches):
        page_number=len(floors)+bi+2
        p=Page(c,A4,page_number,"proposal-scenes",sample,slots);p.header("场景与控制",page_number)
        p.text("让场景贴近生活",M,101,25,bold=True)
        p.text("触发方式、执行动作与关联点位一起核对。",M,143,10,"muted")
        for i,(title,trigger,action) in enumerate(defaults):
            if sample and i>=len(batch):break
            item=batch[i] if sample else {}
            number=bi*per_page+i
            y=184+i*144
            p.text(f"{number+1:02}",M,y,11,"accent",True)
            p.slot(f"scenes.{number}.name",item.get("name",title),(M+37,y-3,460,27),16,True)
            p.text("触发",M+37,y+31,9,"muted");p.slot(f"scenes.{number}.trigger",item.get("trigger",trigger),(M+88,y+29,430,30),9.5,max_lines=2)
            actions=item.get("actions",action)
            if isinstance(actions,list):actions="；".join(actions)
            p.text("动作",M+37,y+63,9,"muted");p.slot(f"scenes.{number}.actions",actions,(M+88,y+60,430,42),9.5,max_lines=3)
            refs=item.get("pointCodes",["关联点位 / 待核对"])
            status=item.get("status","待确认")
            p.slot(f"scenes.{number}.points","、".join(refs)+f" · {status}",(M+37,y+111,480,25),8,max_lines=2)
            p.line(M,y+135,p.w-M,y+135)
        p.text("场景建议需结合实际设备能力与使用习惯确认。",M,774,8.5,"muted");p.end()
    c.save()
    return bg,slots


def paginate_items(items):
    per_page=SPEC["quote"]["rowsPerPage"]
    return [items[i:i+per_page] for i in range(0,len(items),per_page)] or [[]]


def quote(data,sample,images):
    slots=[];bg=WORK/("quote-preview-base.pdf" if sample else "quote-master-base.pdf")
    quote_data=data["quote"];items=quote_data["items"] if sample else []
    batches=paginate_items(items) if sample else [[],[]]
    c=Canvas(str(bg),pagesize=A4);c.setTitle(f"{COMPANY} / 报价单模板 V1");c.setAuthor(COMPANY)
    for pi,batch in enumerate(batches):
        p=Page(c,A4,pi+1,"quote",sample,slots);p.header("配置报价 / 明细续页" if pi else "配置报价",pi+1)
        p.text("智能家居配置报价",M,91,23,bold=True)
        p.slot(f"quote.p{pi+1:03}.project",project_value(data,sample,"name","项目名称"),(M,130,519,26),13,True)
        p.slot(f"quote.p{pi+1:03}.customer",f"客户：{project_value(data,sample,'customer','客户姓名')}",(M,169,225,20),9)
        no=str(quote_data.get("number","报价编号")) if sample else "报价编号"
        p.slot(f"quote.p{pi+1:03}.number",no,(300,169,257,20),9,align="right")
        p.slot(f"quote.p{pi+1:03}.date",f"日期：{project_value(data,sample,'date','出具日期')}",(M,186,225,16),8)
        validity=f"有效期：{quote_data.get('validityDays',7)} 天" if sample else "有效期 / 待填写"
        p.slot(f"quote.p{pi+1:03}.validity",validity,(300,186,257,16),8,align="right")
        y=207;header_h=25;row_h=64
        p.box(M,y,519,header_h,"wash")
        x=M;cols=SPEC["quote"]["columns"];positions={}
        for col in cols:
            positions[col["key"]]=(x,col["width"])
            p.text(col["label"],x+col["width"]/2,y+7,8.5,"muted",align="center");x+=col["width"]
        for ri in range(SPEC["quote"]["rowsPerPage"]):
            top=y+header_h+ri*row_h
            item=batch[ri] if ri<len(batch) else None
            if sample and item is None:continue
            n=pi*SPEC["quote"]["rowsPerPage"]+ri+1
            p.text(str(n),M+11,top+24,8.5,"muted",align="center")
            x,w=positions["image"];p.box(x+5,top+12,w-10,36,"wash",True)
            category=str(item.get("category","其他")) if item else "其他"
            kind="开关" if category in ["单开","双开","三开","四开","场景面板"] else "中控" if "屏" in category else "网络" if category in ["AP","AC","PoE交换机","网络配套"] else None
            image=images[kind] if kind else next((v for key,v in images.items() if key in category),images["其他"])
            p.image_slot(f"quote.p{pi+1:03}.r{ri+1:03}.image",(x+6,top+13,w-12,34),image if item else None)
            slots[-1]["sourcePath"]=f"quote.items[{n-1}].imageSlot"
            x,w=positions["name"]
            name=item["name"] if item else "商品名称 / 规格"
            p.slot(f"quote.p{pi+1:03}.r{ri+1:03}.name",name,(x+7,top+9,w-14,39),9.2,True,max_lines=3)
            sku=item.get("sku","") if item else "型号待填写"
            p.slot(f"quote.p{pi+1:03}.r{ri+1:03}.sku",sku,(x+7,top+48,w-14,12),7)
            x,w=positions["room"];p.slot(f"quote.p{pi+1:03}.r{ri+1:03}.room",item["room"] if item else "房间 / 区域",(x+5,top+13,w-10,43),8.7,max_lines=3)
            x,w=positions["quantity"];qty=f"{item['quantity']:g} {item['unit']}" if item else "数量"
            p.slot(f"quote.p{pi+1:03}.r{ri+1:03}.quantity",qty,(x+3,top+24,w-6,22),8.6,align="center")
            x,w=positions["unitPrice"];p.slot(f"quote.p{pi+1:03}.r{ri+1:03}.unitPrice",money(item['unitPrice']) if item else "单价",(x+5,top+24,w-10,22),9,align="right")
            x,w=positions["lineTotal"];total=Decimal(str(item['quantity']))*Decimal(str(item['unitPrice'])) if item else None
            p.slot(f"quote.p{pi+1:03}.r{ri+1:03}.lineTotal",money(total) if item else "小计",(x+5,top+24,w-10,22),9,True,align="right")
            p.line(M,top+row_h,p.w-M,top+row_h)
        last=pi==len(batches)-1
        p.text(f"明细 {pi+1} / {len(batches)} 页",M,696,8.5,"muted")
        if last:
            values=[("商品合计","subtotal"),("安装调试","installationFee"),("优惠金额","discount")]
            for i,(label,key) in enumerate(values):
                x=M+i*173;p.text(label,x,721,8.5,"muted")
                value=money(quote_data[key]) if sample else "自动计算"
                p.slot(f"quote.summary.{key}",value,(x,738,153,23),12,True)
            p.box(352,769,205,31,"wash")
            p.text("报价合计",363,779,9,"accent",True)
            p.slot("quote.summary.total",money(quote_data["total"]) if sample else "合计金额",(419,773,126,24),16,True,align="right")
            p.text("客户确认：________________",M,782,9,"muted")
        else:
            p.text("配置明细续下页；全部费用在末页汇总。",M,732,10,"muted")
            p.text("图片为类别占位；选型后替换为对应商品图片。",M,756,8,"muted")
        p.end()
    c.save()
    return bg,slots


def pdfcraft_images(cli,bg,slots,destination,stem):
    steps=[{"tool":"doc_open","args":{"path":str(bg)}}]
    for slot in slots:
        if slot["kind"]!="pdfcraft-image":continue
        field=slot["pdfFieldName"]
        steps.append({"tool":"form_add_field","args":{"doc":1,"page":slot["page"],"type":"image","name":field,"rect":slot["rect"]}})
        steps.append({"tool":"form_set_props","args":{"doc":1,"field":field,"appearance":{"border":"none","fill":"none","width":0}}})
        if slot["sampleImage"]:
            steps.append({"tool":"form_set_image","args":{"doc":1,"field":field,"path":slot["sampleImage"]}})
    steps.append({"tool":"doc_save","args":{"doc":1,"path":str(destination),"full":True}})
    script=WORK/f"{stem}.steps.json";script.write_text(json.dumps(steps,ensure_ascii=False,indent=2))
    run=subprocess.run([str(cli),"run","--script",str(script),"--root",str(ROOT)],capture_output=True,text=True,timeout=120)
    (WORK/f"{stem}.result.txt").write_text(run.stdout+run.stderr)
    if run.returncode or not destination.is_file():
        raise RuntimeError(f"PDFCraft失败：{run.stdout[-1500:]}\n{run.stderr[-1500:]}")
    return script


def verify(path,slots,sample):
    from pypdf import PdfReader
    reader=PdfReader(str(path));fields=reader.get_fields() or {}
    expected=[slot for slot in slots if slot["kind"]=="pdfcraft-image"]
    names=[slot["pdfFieldName"] for slot in expected]
    if len(names)!=len(set(names)):raise AssertionError("图片字段重名")
    if set(fields)!=set(names):raise AssertionError("图片字段定义缺失或多余")
    widget_names=[]
    for page in reader.pages:
        for ref in page.get("/Annots",[]):
            a=ref.get_object()
            if a.get("/Subtype")=="/Widget":
                parent=a.get("/Parent");obj=parent.get_object() if parent else a
                name=obj.get("/T") or a.get("/T");widget_names.append(name)
                if name not in fields:raise AssertionError("孤立图片Widget")
                if sample:
                    if not a.get("/AP",{}).get("/N"):raise AssertionError("图片AP缺失")
                    ap=a["/AP"]["/N"].get_object()
                    if not ap.get("/Resources",{}).get("/XObject"):raise AssertionError("图片XObject缺失")
    if sorted(widget_names)!=sorted(names):raise AssertionError("图片Widget数量或名称不一致")
    text="\n".join(page.extract_text() or "" for page in reader.pages)
    if COMPANY not in text:raise AssertionError("公司名文本缺失")
    return {"pages":len(reader.pages),"imageFields":len(fields),"canonicalAndWidgetNamesAgree":True,"embeddedChineseText":True,"sample":sample,"sha256":hashlib.sha256(path.read_bytes()).hexdigest()}


def validate_sample(data):
    if data.get("sampleOnly") is not True:raise AssertionError("此脚本仅接受合成试排数据")
    quote=data["quote"];subtotal=Decimal("0")
    ids=set()
    for row in quote["items"]:
        if row["id"] in ids:raise AssertionError("示例行ID重复")
        ids.add(row["id"])
        value=(Decimal(str(row["quantity"]))*Decimal(str(row["unitPrice"]))).quantize(Decimal(".01"),rounding=ROUND_HALF_UP)
        if value!=Decimal(str(row["lineTotal"])):raise AssertionError("示例行小计有误")
        subtotal+=value
    if subtotal!=Decimal(str(quote["subtotal"])):raise AssertionError("商品合计有误")
    total=subtotal+Decimal(str(quote["installationFee"]))-Decimal(str(quote["discount"]))
    if total!=Decimal(str(quote["total"])):raise AssertionError("报价合计有误")


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument("--cli",type=Path,default=DEFAULT_CLI)
    args=parser.parse_args();register_fonts();WORK.mkdir(parents=True,exist_ok=True);OUT.mkdir(parents=True,exist_ok=True)
    data=json.loads((SPECS/"sample-data.json").read_text());validate_sample(data)
    previous_path=OUT/"生成与核对记录.json"
    previous=json.loads(previous_path.read_text()) if previous_path.is_file() else {"files":{}}
    floor=make_diagram();images=placeholder_images();manifest={"schemaVersion":1,"templateVersion":1,"textStrategy":"embedded-font-source-layout","pictureStrategy":"pdfcraft-named-image-fields","dataSource":"synthetic-sample-data","files":{}}
    jobs=[("设计方案-母版-V1.pdf","proposal-master",False,lambda:proposal(data,False,floor)),("报价单-母版-V1.pdf","quote-master",False,lambda:quote(data,False,images)),("设计方案-模拟套用-V1.pdf","proposal-preview",True,lambda:proposal(data,True,floor)),("报价单-模拟套用-V1.pdf","quote-preview",True,lambda:quote(data,True,images))]
    for filename,stem,sample,build in jobs:
        bg,slots=build();dest=OUT/filename
        if dest.is_file():
            expected=previous.get("files",{}).get(filename,{}).get("sha256")
            if not expected or hashlib.sha256(dest.read_bytes()).hexdigest()!=expected:
                raise RuntimeError(f"{filename} 已在生成后修改，保留该文件。请先另存版本，不自动覆盖人工排版。")
        pdfcraft_images(args.cli,bg,slots,dest,stem)
        checks=verify(dest,slots,sample)
        manifest["files"][filename]={**checks,"slots":slots}
        (SPECS/f"{stem}.slots.v1.json").write_text(json.dumps({"coordinateSystem":"page-points-top-left","version":1,"slots":[{k:v for k,v in slot.items() if k!="sampleImage"} for slot in slots]},ensure_ascii=False,indent=2)+"\n")
        print(f"{filename}: {checks['pages']} 页 / {checks['imageFields']} 图片字段")
    (OUT/"生成与核对记录.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+"\n")


if __name__=="__main__":main()
