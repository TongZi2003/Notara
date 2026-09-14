# 多智能体研讨室

邀请同伴、质疑者和助教独立讨论，支持点名追问。

插件页安装本目录或npm pack生成的tgz。课堂顶部打开工作台，＋或斜杠选择「主持独立研讨」。操作中需要保存时点击相应保存按钮；整理为笔记会显示宿主确认。卸载保留已保存成果。

研讨实际调用独立子会话，模型继承当前课堂，会使用模型额度；助教需要参考标准。可对同一子会话追问，失败/中断不当作完成。

HTML离线打包，沿用双主题；声明的权限见package.json。源码位于examples/plugin-sources，重建命令：node_modules/.bin/tsx scripts/build-learning-plugins.ts。
