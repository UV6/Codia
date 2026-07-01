# Codia 安装说明

这份文档面向拿到 `codia-*.tgz` 安装包后，准备在另一台电脑上安装运行的人。

## 环境要求

硬要求：

- `Node.js >= 20`
- 可用的 `npm`
- 可联网访问你所选模型供应商的 API

建议要求：

- `git`
- macOS 或 Linux 终端环境

## 安装方式

假设你已经拿到了安装包：

```bash
codia-0.1.0.tgz
```

进入安装包所在目录后执行：

```bash
npm install -g ./codia-0.1.0.tgz
```

安装完成后，可执行命令：

```bash
codia
codia --help
codia --sessions
codia --session <id>
codia --bypassPermissions
```

## 首次启动

直接运行：

```bash
codia
```

如果当前机器上还没有配置文件，Codia 会自动进入交互式初始化流程，引导你选择：

- `OpenAI`
- `Anthropic`
- `DeepSeek (OpenAI 兼容)`

引导过程中会自动推荐：

- 默认模型
- 默认 `base_url`

你可以直接回车接受默认值，也可以手动修改。

初始化完成后，配置会写到：

```bash
~/.codia/Codia.yml
```

如果你想把用户数据和配置写到自定义目录，可以这样启动：

```bash
CODIA_HOME=/path/to/codia-home codia
```

这时配置文件路径会变成：

```bash
/path/to/codia-home/Codia.yml
```

## 常见配置示例

### OpenAI

```yaml
protocol: openai
model: gpt-5.4
base_url: https://api.openai.com
api_key: YOUR_OPENAI_API_KEY
```

### Anthropic

```yaml
protocol: anthropic
model: claude-opus-4-6
base_url: https://api.anthropic.com
api_key: YOUR_ANTHROPIC_API_KEY
```

### DeepSeek

```yaml
protocol: openai
model: deepseek-v4-flash
base_url: https://api.deepseek.com
api_key: YOUR_DEEPSEEK_API_KEY
```

## 常见问题

### 1. 安装时报错

先确认：

- `node -v`
- `npm -v`

如果 `Node.js` 版本低于 20，请先升级。

### 2. 启动时报缺少配置文件

如果是首次启动，这是正常现象。直接运行：

```bash
codia
```

按引导完成初始化即可。

如果你不想走引导，也可以手动创建：

```bash
~/.codia/Codia.yml
```

### 3. 能启动，但发送消息时报认证失败

这通常说明：

- `api_key` 错了
- `protocol` 和 `base_url` 不匹配
- 选错了模型供应商

建议先检查配置文件里的这四项：

- `protocol`
- `model`
- `base_url`
- `api_key`

### 4. 没有历史会话

执行：

```bash
codia --sessions
```

如果显示“暂无历史会话”，说明当前用户目录下还没有产生会话文件，属于正常现象。

### 5. 旧版本数据在 `~/.Codia`

如果你之前使用过旧目录名，可以迁移：

```bash
mkdir -p ~/.codia
cp -R ~/.Codia/* ~/.codia/
```

## 给分发者的建议

如果你要把安装包发给其他人，建议同时附带这三条最小说明：

```bash
npm install -g ./codia-0.1.0.tgz
codia --help
codia
```

如果是第一次安装，最后一条命令会自动进入初始化引导。
