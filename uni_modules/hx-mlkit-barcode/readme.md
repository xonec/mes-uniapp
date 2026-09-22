# mlkit-barcode
### 开发文档
[UTS 语法](https://uniapp.dcloud.net.cn/tutorial/syntax-uts.html)
[UTS API插件](https://uniapp.dcloud.net.cn/plugin/uts-plugin.html)
[UTS uni-app兼容模式组件](https://uniapp.dcloud.net.cn/plugin/uts-component.html)
[UTS 标准模式组件](https://doc.dcloud.net.cn/uni-app-x/plugin/uts-vue-component.html)
[Hello UTS](https://gitcode.net/dcloud/hello-uts)
`

```vue
<template>
	<view class="container">
		<button @click="pickImageAndScan">从相册选取并识别</button>

		<view v-if="resultText" class="result">
			<text>识别结果：</text>
			<text>{{ resultText }}</text>
		</view>
	</view>
</template>

<script setup>
	import {
		ref
	} from 'vue';
	import {
		scanBarcode
	} from '@/uni_modules/mlkit-barcode';

	const resultText = ref('');

	const pickImageAndScan = () => {
		uni.chooseImage({
			count: 1, // 仅选一张
			sourceType: ['album'], // 强制从相册选择
			success: (res) => {
				const tempFilePath = res.tempFilePaths[0];

				uni.showLoading({
					title: '识别中...'
				});

				// 调用 UTS 插件进行识别
				scanBarcode({
					imagePath: tempFilePath,
					success: (scanRes) => {
						uni.hideLoading();
						if (scanRes.barcodes.length > 0) {
							// 提取所有条码的值并展示
							resultText.value = scanRes.barcodes.map(b => b.rawValue).join(
								'\n');
						} else {
							resultText.value = '未识别到任何条码/二维码';
						}
					},
					fail: (err) => {
						uni.hideLoading();
						uni.showToast({
							title: '识别出错: ' + err.message,
							icon: 'none'
						});
					}
				});
			}
		});
	};
</script>

<style>
	.container {
		padding: 20px;
	}

	.result {
		margin-top: 20px;
		color: #333;
	}
</style>
```

`