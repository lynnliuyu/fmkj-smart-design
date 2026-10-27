---
name: FMKJ 项目管理
description: 面向智能家居项目的中性色密集工作台——安静、对齐、下一步永远看得见
colors:
  primary: "oklch(0.205 0 0)"
  primary-foreground: "oklch(0.985 0 0)"
  background: "oklch(1 0 0)"
  foreground: "oklch(0.145 0 0)"
  card: "oklch(1 0 0)"
  muted: "oklch(0.97 0 0)"
  muted-foreground: "oklch(0.53 0 0)"
  border: "oklch(0.922 0 0)"
  input: "oklch(0.922 0 0)"
  ring: "oklch(0.708 0 0)"
  destructive: "oklch(0.577 0.245 27.325)"
  destructive-strong: "oklch(0.47 0.2 27.325)"
  success: "oklch(0.52 0.12 155)"
  warning: "oklch(0.52 0.11 75)"
typography:
  body:
    fontFamily: "Inter, PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans SC, sans-serif"
    fontSize: "14px"
    lineHeight: 1.5
  label:
    fontFamily: "inherit"
    fontSize: "12px"
    lineHeight: 1.4
  title:
    fontFamily: "inherit"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.35
  headline:
    fontFamily: "inherit"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  metric:
    fontFamily: "inherit"
    fontSize: "16px"
    fontWeight: 600
    fontFeature: "tabular-nums"
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "14px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.md}"
    height: "36px"
    padding: "0 16px"
  button-primary-hover:
    backgroundColor: "oklch(0.32 0 0)"
  button-outline:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    height: "36px"
    padding: "0 16px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    height: "36px"
  input:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    height: "36px"
    padding: "0 12px"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.card-foreground}"
    rounded: "{rounded.xl}"
    padding: "16px"
  badge-neutral:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.muted-foreground}"
    rounded: "9999px"
    height: "22px"
    padding: "0 8px"
---

# Design System: FMKJ 项目管理

## Overview

**Creative North Star: "车间里的白墙"**

这是一套内部工作台，不是展示页。用户一天要在里面待几个小时，处理的是客户的房子、产品的件数和报价的金额。所以视觉的目标不是"让人记住"，而是**让人不累**：颜色退到背景，结构浮到前面，重要的动作永远在同一只手上够得到。

整套系统只有一个强调色——近黑。它只用在"主按钮"和"当前进度"上，一屏最多出现两处。其余全部靠层次：白底、浅灰底、1px 描边。没有阴影堆叠，没有渐变，没有装饰性的色块。密度高但不挤，因为信息靠对齐组织，不靠分隔线切割。

这套方向是在**保留现有界面**的前提下收紧的：不换视觉语言、不换骨架，只是把重复的入口、无信息的徽章、看不清的灰字和七种圆角收成一套规矩。

**Key Characteristics:**
- 中性灰阶 + 单一近黑强调色，强调色出现次数极少。
- 平面优先：靠 1px 描边和底色分层，不用阴影做装饰。
- 表格数字等宽对齐，金额和数量永远上下对齐。
- 次要文字有对比度下限，不靠"浅灰"表达次要。
- 每个页面一个主任务，同一件事只有一个入口。

## Colors

整套配色是无彩色的灰阶，唯一的高饱和色是错误红。这让客户的房子照片、产品图和点位图成为页面上唯一有颜色的东西。

### Primary
- **墨黑** (`oklch(0.205 0 0)`，近 `#252525`): 主按钮底色、当前选中项、关键数字。不是纯黑，避免在白色背景上产生硬边。

### Neutral
- **纸白** (`oklch(1 0 0)`): 页面和卡片底色。
- **浅灰底** (`oklch(0.97 0 0)`): 次级容器、表头、选中行、无边框分组。用来替代"再加一层卡片"。
- **描边灰** (`oklch(0.922 0 0)`): 1px 分隔线和输入框描边。这是本系统最主要的层次手段。
- **次要文字** (`oklch(0.53 0 0)`): 说明、字段名、时间戳、占位符。在浅灰底上是 4.82:1，白底上 5.25:1。
- **正文** (`oklch(0.145 0 0)`): 标题、数据、按钮文字。

### Tertiary
- **错误红** (`oklch(0.577 0.245 27.325)`): 删除、校验失败、风险。
- **警示红字** (`oklch(0.47 0.2 27.325)`): 只在红色浅底上使用的文字色，保证 4.5:1。
- **成功绿** (`oklch(0.52 0.12 155)`) / **提醒黄** (`oklch(0.52 0.11 75)`): 状态点和小面积标识，不做大面积底色。

### Named Rules
**The One Accent Rule.** 近黑强调色在任何一屏上最多出现两处（一个主按钮 + 一处当前状态）。第三个黑色按钮意味着有两个主任务，需要拆页面。

**The Tinted-Text Rule.** 在有色浅底（如 `--destructive/10`）上写文字，必须用对应的 `-strong` 色，不能直接用底色本身。实测直接用 `--destructive` 只有 4.0:1。

## Typography

**Display Font:** 无独立展示字体，标题与正文同族
**Body Font:** Inter（拉丁）+ PingFang SC / Microsoft YaHei / Noto Sans SC（中文）

**Character:** 界面全是中文，拉丁字体只负责数字和编号。中文字体链显式写死，不依赖每台机器的默认回退，否则同一个界面在不同电脑上行高和字宽会变。数字统一用等宽数字（tabular-nums），让金额列和数量列能对齐。

**已记录的例外（2026-10-22）：** 自动检测器在 22 个页面报 `overused-font`，理由是 Inter 被用得太普遍、缺少个性。这里**有意保留**：用户明确选了「保留现在的样子，只做减法与统一」，而换掉正文族属于品牌层面的观感变更，不在这次范围内。如果以后要换，这是一次单独的品牌决策，不是顺手改的清理项；换的时候必须连中文字体链一起定，并重新核对所有数字列的对齐。

### Hierarchy
- **Headline** (700, 24px, 1.2): 页面主标题。一页只有一个。
- **Title** (600, 18px, 1.35): 卡片或分组的标题。
- **Body** (400, 14px, 1.5): 正文、表格内容、按钮文字、输入内容。
- **Label** (500, 12px, 1.4): 字段名、次要说明、徽章、表头。

### Named Rules
**The 12px Floor Rule.** 界面上不出现小于 12px 的文字。低于 12px 的中文在 1366×768 的办公屏幕上读不清。

**The Aligned Numbers Rule.** 任何成列出现的金额、数量、日期都使用等宽数字并右对齐；比例数字会让右对齐的列参差不齐。

## Layout

桌面优先，主要适配 1366×768 到 1980×1080。左侧固定导航（可折叠成图标），顶栏 64px 高，内容区最大宽度不限制但左右各留 24px。

页面骨架统一为三段：**标题行**（标题 + 右侧唯一主操作）→ **筛选/状态行** → **内容**。统计数字如果是 0 就不出现在标题行里。

卡片内部不再嵌套卡片；需要分组时用浅灰底或 1px 分隔线，不新增一层边框。

间距节奏：区块之间 24px，区块内元素之间 12px，紧密关联的元素之间 4–8px。标题上方留白大于下方。

## Elevation & Depth

**平面优先，几乎不用阴影。** 层次由三样东西表达：白底 / 浅灰底 / 1px 描边。阴影只出现在浮层（对话框、下拉菜单、命令面板）上，作为"这个东西浮在页面之上"的物理说明，不作为装饰。

### Shadow Vocabulary
- **浮层** (`box-shadow: 0 10px 30px -12px oklch(0 0 0 / 0.25)`): 对话框、下拉菜单、命令面板。
- **吸顶** (`box-shadow: 0 1px 0 0 oklch(0.922 0 0)`): 顶栏滚动后与内容的界线，用一条线而不是一团影。

### Named Rules
**The No-Decorative-Shadow Rule.** 卡片、按钮、统计块在静止状态下没有阴影。悬停可以改变底色，但不长出阴影。

## Shapes

圆角只有三档，全部来自 `--radius: 10px`：

- **容器**（卡片、面板、对话框）：14px（`rounded-xl`）。
- **控件**（按钮、输入框、下拉、标签页）：8px（`rounded-md`）。
- **胶囊**（状态徽章、头像、计数点）：全圆。

**不允许出现 `rounded-2xl` / `rounded-3xl` 的输入框、按钮或卡片**——实测界面里同时存在七种圆角，其中 24px 圆角的卡片、18px 圆角的搜索框和 6px 圆角的按钮并排，看起来像三套系统。2026-10-22 已把 `components/ui/` 里的基础控件统一到上面三档。

## Components

### Buttons
- **Shape:** 8px 圆角（`rounded-md`），高 36px，横向内边距 16px；密集工具栏里可以降到 32px。
- **Primary:** 墨黑底 + 纸白字。一屏一个，代表这一页的主操作。
- **Hover / Focus:** 悬停加深底色（`oklch(0.32 0 0)`）；键盘聚焦显示 2px 环，颜色 `--ring`。
- **Outline:** 白底 + 1px 描边，用于次级操作。
- **Ghost:** 无底无框，用于图标按钮和行内操作。

### Badges / 状态标注
- **Style:** 胶囊形，12px 字，浅灰底 + 次要文字色。需要区分状态时最多用三种语义色（中性、警示红、成功绿）。
- **Rule:** 徽章只在**状态会变、且用户需要据此决策**时出现。每个项目都一样的"正常"徽章不出现。

### Cards / Containers
- **Corner Style:** 14px（`rounded-xl`）。
- **Background:** 白底；次级容器用浅灰底（`--muted`）。
- **Border:** 1px `--border`。**不允许卡片套卡片**——实测 9 个页面共 22 处。
- **Internal Padding:** 16px；紧凑表格容器可以用 12px。

### Inputs / Fields
- **Style:** 白底 + 1px 描边，8px 圆角，高 36px。
- **Focus:** 描边变为 `--ring` 并加 2px 环。
- **Placeholder:** 使用 `--muted-foreground`（4.5:1 以上），不能比它更浅。
- **Search:** 一个页面只允许一个搜索框。页面级搜索与卡片内筛选如果作用相同，删掉一个。

### Navigation
- **侧边栏**：承载全部一级入口，可折叠为图标。
- **顶栏**：只放全局动作（快速跳转、通知、主题、语言）和当前业务线的段落切换。**不重复侧边栏已有的入口。**
- **快速跳转（⌘K）**：顶栏唯一的搜索入口，搜项目和页面。它以前是个写着 ⌘K 但点了没反应的按钮。

### 编辑型工作台（点位图）
- **三栏常驻**：左侧设备调色板 / 中间画布 / 右侧属性栏。右栏宽度固定，**不随选中状态变化**。
- **不要让画布因为操作而改变尺寸**。面板浮起来（加 margin 让位）会让图纸「一下大一下小」，
  这是最容易让人觉得「页面在抖」的原因。属性栏宁常常驻占位，也不要弹出挤动画布。
- 没选中对象时右栏**展示概览**（当前楼层、点位数、已确认、待定位、场景数），不是一块空白。
- 状态徽章可以点击（例如冲突时点它打开处理弹窗），**不额外新增按钮**——
  多一个按钮就可能把页头挤成两行，整页高度跟着变。
- 工具栏行固定高度、禁止换行：内容随数据加载变化时，换行会让画布高度跳。

### 空状态
- 用一句话说明"这里会出现什么"和"下一步点哪里"，不需要插画。
- 不给 0 值做统计卡；为空的字段直接不渲染，而不是显示 "—"。

## Do's and Don'ts

### Do:
- **Do** 让每页的第一个视觉焦点是"这个项目现在卡在哪、下一步点哪个按钮"。
- **Do** 用 1px 描边和浅灰底做分层，把卡片留给真正独立的信息块。
- **Do** 所有成列数字加 `tabular-nums` 并右对齐。
- **Do** 次要文字用 `--muted-foreground`，不要用更浅的自定义灰。
- **Do** 表单控件和按钮统一 8px 圆角，容器统一 10px。
- **Do** 复制里的按钮写清楚动作："保存草稿"而不是"确定"。

### Don't:
- **Don't** 卡片里再套卡片。需要分组就用底色或分隔线。
- **Don't** 展示值为 0 或无内容的统计块、徽章、字段。
- **Don't** 在同一个页面放两个作用相同的搜索/筛选入口。
- **Don't** 在有色浅底上直接用底色字（用 `-strong` 变体）。
- **Don't** 用 `rounded-2xl` / `rounded-3xl` 做按钮或输入框。
- **Don't** 写小于 12px 的文字。
- **Don't** 用阴影表达层级；用描边。
- **Don't** 改动已定版的客户交付内容（报价单 A4 排版、方案 PDF、交付图）的视觉规则；它们由 `app/globals.css` 的 `@media print` 段落单独管理。
