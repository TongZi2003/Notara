# 时空地图

把事件连到时间、地点、原文与课堂。

插件页安装本目录或npm pack生成的tgz。课堂顶部打开工作台，＋或斜杠选择「整理时空线索」。操作中需要保存时点击相应保存按钮；整理为笔记会显示宿主确认。卸载保留已保存成果。

工作台中的示例、猜想和草稿不代表学生掌握；老师只能读取已经保存或发到对话的内容。

HTML离线打包，沿用双主题；声明的权限见package.json。源码位于examples/plugin-sources，重建命令：node_modules/.bin/tsx scripts/build-learning-plugins.ts。底图使用Natural Earth public domain land数据：https://www.naturalearthdata.com/about/terms-of-use/ 。地图不表示历史疆域。
