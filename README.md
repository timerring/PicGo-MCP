# picgo-mcp

> **快速开始：** 将下面的 prompt 发送给你的 Coding Agent：`请从 https://github.com/timerring/PicGo-MCP 安装并配置 PicGo MCP Server。`

一个将 [PicGo Core](https://github.com/PicGo/PicGo-Core) 直接嵌入进程的 MCP stdio server。它可以让 Codex、Claude Desktop 等 MCP 客户端复用已有的 PicGo 图床配置，不要求 PicGo 桌面端运行，也不经过 `127.0.0.1:36677`。

## 特性

- 直接调用 PicGo Core 3，无桌面端依赖。
- 支持本地文件、`file://` URL 和 HTTP(S) 图片 URL。
- 支持单图与最多 20 张图片的批量上传。
- 自动发现 PicGo Desktop、PicGo Core 和 CLI 配置。
- 支持自定义上传文件名与返回格式。
- 并发调用自动排队，避免 PicGo 的可变上传状态互相污染。
- 状态工具不返回 token、secret 等配置值，并将用户主目录显示为 `~`。

## 环境要求

- Node.js `>=20.19.0`
- 一个可工作的 PicGo 配置文件

## 安装

从源码安装：

```bash
npm install
npm run build
npm install -g .
```

确认命令可用：

```bash
picgo-mcp --help
```

### 安装到 Codex

```bash
codex mcp add picgo -- picgo-mcp
codex mcp get picgo
```

新增 MCP server 后，新建任务或刷新客户端，使工具清单重新加载。

### 其他 MCP 客户端

全局安装后，可以使用以下 stdio 配置：

```json
{
  "mcpServers": {
    "picgo": {
      "command": "picgo-mcp"
    }
  }
}
```

需要明确指定配置文件时：

```json
{
  "mcpServers": {
    "picgo": {
      "command": "picgo-mcp",
      "args": ["--config", "/path/to/picgo/config.json"]
    }
  }
}
```

也可以设置环境变量 `PICGO_CONFIG_PATH`。`--config` 的优先级高于环境变量和自动发现。

## PicGo 配置

默认按顺序查找：

- macOS：`~/Library/Application Support/picgo/data.json`
- Windows：`%APPDATA%/picgo/data.json`
- Linux：`$XDG_CONFIG_HOME/picgo/data.json` 或 `~/.config/picgo/data.json`
- 所有平台：`~/.picgo/config.json`

### GitHub 图床示例

下面的示例将图片上传到仓库的 `images/` 目录，并通过 jsDelivr 返回 CDN 地址：

```json
{
  "picBed": {
    "uploader": "github",
    "current": "github",
    "github": {
      "repo": "OWNER/REPOSITORY",
      "branch": "main",
      "path": "images/",
      "customUrl": "https://cdn.jsdelivr.net/gh/OWNER/REPOSITORY@main",
      "token": "YOUR_GITHUB_TOKEN"
    }
  },
  "picgoPlugins": {},
  "settings": {
    "picgoMcp": {
      "uploadNameTemplate": "${dateTime}-${fileName}${extName}",
      "outputFormat": "${url}"
    }
  }
}
```

GitHub token 需要对目标仓库具备写入权限。不要把真实 token 提交到 Git、Issue、日志或聊天记录中，并将配置文件权限限制为当前用户可读：

```bash
chmod 600 ~/.picgo/config.json
```

PicGo Core 3 首次读取旧版配置时可能补充 `uploader` 配置和内部元数据，这是正常的自动迁移行为。

## 文件名模板

配置位置：

```json
{
  "settings": {
    "picgoMcp": {
      "uploadNameTemplate": "${dateTime}-${fileName}${extName}"
    }
  }
}
```

支持的变量：

| 变量 | 示例 | 说明 |
| --- | --- | --- |
| `${date}` | `2026-08-23` | 本地日期 |
| `${dateTime}` | `2026-08-23-17-34-47` | 精确到秒的本地时间 |
| `${fileName}` | `example` | 原文件名，不含扩展名 |
| `${extName}` | `.png` | 原扩展名 |
| `${imgIdx}` | `0`、`1` | 批量上传时的零基序号；单图上传为空 |

推荐使用：

```text
${dateTime}-${fileName}${extName}
```

只使用 `${dateTime}${extName}` 可能让同一秒内上传的图片发生重名。模板只执行白名单占位符替换，不执行 JavaScript，并且不允许通过文件名写入 `../` 等额外路径；远端目录应使用上传器的 `path` 配置。

## 输出模板

配置位置：

```json
{
  "settings": {
    "picgoMcp": {
      "outputFormat": "${url}"
    }
  }
}
```

支持的变量：

- `${url}`：上传后的图片 URL。
- `${uploadedName}`：上传后的文件名，不含扩展名。

常用格式：

```text
${url}
![${uploadedName}](${url})
```

工具响应始终包含图片信息、URL 数组、Markdown 和按模板生成的 `formattedOutput`，因此调用方可以根据需要选择字段。

## MCP 工具

### `upload_image`

上传一张本地或远程图片：

```json
{
  "source": "/path/to/image.png"
}
```

### `upload_images`

批量上传 1–20 张图片：

```json
{
  "sources": [
    "/path/to/first.png",
    "https://example.com/second.jpg"
  ]
}
```

### `get_picgo_status`

返回配置是否存在、PicGo 版本、当前上传器、已配置字段名和可用上传器。该工具不会返回配置值或图床凭据。

## 上传结果示例

```json
{
  "images": [
    {
      "url": "https://cdn.example.com/images/2026-08-23-17-34-47-example.png",
      "fileName": "2026-08-23-17-34-47-example.png",
      "width": 800,
      "height": 600,
      "size": 123456
    }
  ],
  "urls": [
    "https://cdn.example.com/images/2026-08-23-17-34-47-example.png"
  ],
  "markdown": "![2026-08-23-17-34-47-example.png](https://cdn.example.com/images/2026-08-23-17-34-47-example.png)",
  "formattedOutput": "https://cdn.example.com/images/2026-08-23-17-34-47-example.png"
}
```

## 运行机制

MCP 客户端通常会启动一个 `picgo-mcp` stdio 进程，并在当前客户端会话期间复用它。只有调用上传工具时才会读取图片并访问图片来源和图床服务；客户端关闭连接后，server 进程退出并释放内存。

PicGo 会在实例上保存可变的输入和输出状态，因此本项目会将并发上传请求串行执行。

## 安全说明

- 不要在命令参数中传递 token，凭据应由 PicGo 配置管理。
- MCP 工具不会返回图床凭据；状态工具只返回字段名。
- 主目录路径在工具响应中会被替换为 `~`。
- HTTP(S) 图片会先由 PicGo 下载，再上传到已配置图床。
- PicGo 会按配置加载插件，只安装并启用可信插件。
- 不要把 stdio server 暴露给不可信客户端。

PicGo 3.0.1 的依赖树目前仍包含 `image-size` 和旧版 `inquirer/tmp` 的 npm 安全公告。前者处理特制图片时可能造成进程拒绝服务，后者位于本项目不调用的 PicGo CLI 交互路径。这些依赖需要由 PicGo 上游升级。

## 开发与验证

```bash
npm install
npm test
npm run check
npm run build
```

当前测试覆盖配置发现、MCP 工具注册、状态脱敏、上传输入校验、命名模板、输出模板和发布文件隐私检查。

## License

[MIT](./LICENSE)
