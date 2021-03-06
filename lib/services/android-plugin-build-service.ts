import * as path from "path";
import { MANIFEST_FILE_NAME, INCLUDE_GRADLE_NAME, ASSETS_DIR, RESOURCES_DIR } from "../constants";
import { getShortPluginName, hook } from "../common/helpers";
import { Builder, parseString } from "xml2js";
import { ILogger } from "log4js";

export class AndroidPluginBuildService implements IAndroidPluginBuildService {

	/**
	 * Required for hooks execution to work.
	 */
	private get $hooksService(): IHooksService {
		return this.$injector.resolve("hooksService");
	}

	constructor(private $injector: IInjector,
		private $fs: IFileSystem,
		private $childProcess: IChildProcess,
		private $hostInfo: IHostInfo,
		private $androidToolsInfo: IAndroidToolsInfo,
		private $logger: ILogger) { }

	private static MANIFEST_ROOT = {
		$: {
			"xmlns:android": "http://schemas.android.com/apk/res/android"
		}
	};
	private static ANDROID_PLUGIN_GRADLE_TEMPLATE = "../../vendor/gradle-plugin";

	private getAndroidSourceDirectories(source: string): Array<string> {
		const directories = [RESOURCES_DIR, "java", ASSETS_DIR, "jniLibs"];
		const resultArr: Array<string> = [];

		this.$fs.enumerateFilesInDirectorySync(source, (file, stat) => {
			if (stat.isDirectory() && _.some(directories, (element) => file.endsWith(element))) {
				resultArr.push(file);
				return true;
			}
		});

		return resultArr;
	}

	private getManifest(platformsDir: string): string {
		const manifest = path.join(platformsDir, MANIFEST_FILE_NAME);
		return this.$fs.exists(manifest) ? manifest : null;
	}

	private async updateManifestContent(oldManifestContent: string, defaultPackageName: string): Promise<string> {
		let xml: any = await this.getXml(oldManifestContent);

		let packageName = defaultPackageName;
		// if the manifest file is full-featured and declares settings inside the manifest scope
		if (xml["manifest"]) {
			if (xml["manifest"]["$"]["package"]) {
				packageName = xml["manifest"]["$"]["package"];
			}

			// set the xml as the value to iterate over its properties
			xml = xml["manifest"];
		}

		// if the manifest file doesn't have a <manifest> scope, only the first setting will be picked up
		const newManifest: any = { manifest: {} };
		for (const prop in xml) {
			newManifest.manifest[prop] = xml[prop];
		}

		newManifest.manifest["$"]["package"] = packageName;

		const xmlBuilder = new Builder();
		const newManifestContent = xmlBuilder.buildObject(newManifest);

		return newManifestContent;
	}

	private createManifestContent(packageName: string): string {
		const newManifest: any = { manifest: AndroidPluginBuildService.MANIFEST_ROOT };
		newManifest.manifest["$"]["package"] = packageName;
		const xmlBuilder: any = new Builder();
		const newManifestContent = xmlBuilder.buildObject(newManifest);

		return newManifestContent;
	}

	private async getXml(stringContent: string): Promise<any> {
		const promise = new Promise<any>((resolve, reject) =>
			parseString(stringContent, (err: any, result: any) => {
				if (err) {
					reject(err);
				} else {
					resolve(result);
				}
			})
		);

		return promise;
	}

	private getIncludeGradleCompileDependenciesScope(includeGradleFileContent: string): Array<string> {
		const indexOfDependenciesScope = includeGradleFileContent.indexOf("dependencies");
		const result: Array<string> = [];

		if (indexOfDependenciesScope === -1) {
			return result;
		}

		const indexOfRepositoriesScope = includeGradleFileContent.indexOf("repositories");

		let repositoriesScope = "";
		if (indexOfRepositoriesScope >= 0) {
			repositoriesScope = this.getScope("repositories", includeGradleFileContent);
			result.push(repositoriesScope);
		}

		const dependenciesScope = this.getScope("dependencies", includeGradleFileContent);
		result.push(dependenciesScope);

		return result;
	}

	private getScope(scopeName: string, content: string): string {
		const indexOfScopeName = content.indexOf(scopeName);
		let result = "";
		const openingBracket = "{";
		const closingBracket = "}";
		let openBrackets = 0;
		let foundFirstBracket = false;

		let i = indexOfScopeName;
		while (i < content.length) {
			const currCharacter = content[i];
			if (currCharacter === openingBracket) {
				if (openBrackets === 0) {
					foundFirstBracket = true;
				}

				openBrackets++;
			}

			if (currCharacter === closingBracket) {
				openBrackets--;
			}

			result += currCharacter;

			if (openBrackets === 0 && foundFirstBracket) {
				break;
			}

			i++;
		}

		return result;
	}

	/**
	 * Returns whether the build has completed or not
	 * @param {Object} options
	 * @param {string} options.pluginName - The name of the plugin. E.g. 'nativescript-barcodescanner'
	 * @param {string} options.platformsAndroidDirPath - The path to the 'plugin/src/platforms/android' directory.
	 * @param {string} options.aarOutputDir - The path where the aar should be copied after a successful build.
	 * @param {string} options.tempPluginDirPath - The path where the android plugin will be built.
	 */
	public async buildAar(options: IBuildOptions): Promise<boolean> {
		this.validateOptions(options);

		// IDEA: Accept as an additional parameter the Android Support Library version from CLI, pass it on as -PsupportVersion later to the build
		// IDEA: apply app.gradle here in order to get any and all user-defined variables
		// IDEA: apply the entire include.gradle here instead of copying over the repositories {} and dependencies {} scopes

		const shortPluginName = getShortPluginName(options.pluginName);
		const newPluginDir = path.join(options.tempPluginDirPath, shortPluginName);
		const newPluginMainSrcDir = path.join(newPluginDir, "src", "main");
		const defaultPackageName = "org.nativescript." + shortPluginName;

		// find manifest file
		//// prepare manifest file content
		const manifestFilePath = this.getManifest(options.platformsAndroidDirPath);
		let shouldBuildAar = false;

		// look for AndroidManifest.xml
		if (manifestFilePath) {
			shouldBuildAar = true;
		}

		// look for android resources
		const androidSourceSetDirectories = this.getAndroidSourceDirectories(options.platformsAndroidDirPath);

		if (androidSourceSetDirectories.length > 0) {
			shouldBuildAar = true;
		}

		// if a manifest OR/AND resource files are present - write files, build plugin
		if (shouldBuildAar) {
			let updatedManifestContent;
			this.$fs.ensureDirectoryExists(newPluginMainSrcDir);

			if (manifestFilePath) {
				let androidManifestContent;
				try {
					androidManifestContent = this.$fs.readText(manifestFilePath);
				} catch (err) {
					throw new Error(
						`Failed to fs.readFileSync the manifest file located at ${manifestFilePath}`
					);
				}

				updatedManifestContent = await this.updateManifestContent(androidManifestContent, defaultPackageName);
			} else {
				updatedManifestContent = this.createManifestContent(defaultPackageName);
			}

			// write the AndroidManifest in the temp-dir/plugin-name/src/main
			const pathToNewAndroidManifest = path.join(newPluginMainSrcDir, MANIFEST_FILE_NAME);
			try {
				this.$fs.writeFile(pathToNewAndroidManifest, updatedManifestContent);
			} catch (e) {
				throw new Error(`Failed to write the updated AndroidManifest in the new location - ${pathToNewAndroidManifest}`);
			}

			// copy all android sourceset directories to the new temporary plugin dir
			for (const dir of androidSourceSetDirectories) {
				// get only the last subdirectory of the entire path string. e.g. 'res', 'java', etc.
				const dirNameParts = dir.split(path.sep);
				const dirName = dirNameParts[dirNameParts.length - 1];

				const destination = path.join(newPluginMainSrcDir, dirName);
				this.$fs.ensureDirectoryExists(destination);

				this.$fs.copyFile(path.join(dir, "*"), destination);
			}

			// copy the preconfigured gradle android library project template to the temporary android library
			this.$fs.copyFile(path.join(path.resolve(path.join(__dirname, AndroidPluginBuildService.ANDROID_PLUGIN_GRADLE_TEMPLATE), "*")), newPluginDir);

			// sometimes the AndroidManifest.xml or certain resources in /res may have a compile dependency to a library referenced in include.gradle. Make sure to compile the plugin with a compile dependency to those libraries
			const includeGradlePath = path.join(options.platformsAndroidDirPath, INCLUDE_GRADLE_NAME);
			if (this.$fs.exists(includeGradlePath)) {
				const includeGradleContent = this.$fs.readText(includeGradlePath);
				const repositoriesAndDependenciesScopes = this.getIncludeGradleCompileDependenciesScope(includeGradleContent);

				// dependencies { } object was found - append dependencies scope
				if (repositoriesAndDependenciesScopes.length > 0) {
					const buildGradlePath = path.join(newPluginDir, "build.gradle");
					this.$fs.appendFile(buildGradlePath, "\n" + repositoriesAndDependenciesScopes.join("\n"));
				}
			}

			// finally build the plugin
			this.$androidToolsInfo.validateInfo({ showWarningsAsErrors: true, validateTargetSdk: true });
			const androidToolsInfo = this.$androidToolsInfo.getToolsInfo();
			await this.buildPlugin( { pluginDir: newPluginDir, pluginName: options.pluginName, androidToolsInfo });

			const finalAarName = `${shortPluginName}-release.aar`;
			const pathToBuiltAar = path.join(newPluginDir, "build", "outputs", "aar", finalAarName);

			if (this.$fs.exists(pathToBuiltAar)) {
				try {
					if (options.aarOutputDir) {
						this.$fs.copyFile(pathToBuiltAar, path.join(options.aarOutputDir, `${shortPluginName}.aar`));
					}
				} catch (e) {
					throw new Error(`Failed to copy built aar to destination. ${e.message}`);
				}

				return true;
			} else {
				throw new Error(`No built aar found at ${pathToBuiltAar}`);
			}
		}

		return false;
	}

	/**
	 * @param {Object} options
	 * @param {string} options.platformsAndroidDirPath - The path to the 'plugin/src/platforms/android' directory.
	 */
	public migrateIncludeGradle(options: IBuildOptions): boolean {
		this.validatePlatformsAndroidDirPathOption(options);

		const includeGradleFilePath = path.join(options.platformsAndroidDirPath, INCLUDE_GRADLE_NAME);

		if (this.$fs.exists(includeGradleFilePath)) {
			let includeGradleFileContent: string;
			try {
				includeGradleFileContent = this.$fs.readFile(includeGradleFilePath).toString();
			} catch (err) {
				throw new Error(`Failed to fs.readFileSync the include.gradle file located at ${includeGradleFilePath}`);
			}

			const productFlavorsScope = this.getScope("productFlavors", includeGradleFileContent);

			try {
				const newIncludeGradleFileContent = includeGradleFileContent.replace(productFlavorsScope, "");
				this.$fs.writeFile(includeGradleFilePath, newIncludeGradleFileContent);

				return true;
			} catch (e) {
				throw new Error(`Failed to write the updated include.gradle in - ${includeGradleFilePath}`);
			}
		}

		return false;
	}

	@hook("buildAndroidPlugin")
	private async buildPlugin(pluginBuildSettings: IBuildAndroidPluginData): Promise<void> {
		const gradlew = this.$hostInfo.isWindows ? "gradlew.bat" : "./gradlew";

		const localArgs = [
			"-p",
			pluginBuildSettings.pluginDir,
			"assembleRelease",
			`-PcompileSdk=android-${pluginBuildSettings.androidToolsInfo.compileSdkVersion}`,
			`-PbuildToolsVersion=${pluginBuildSettings.androidToolsInfo.buildToolsVersion}`,
			`-PsupportVersion=${pluginBuildSettings.androidToolsInfo.supportRepositoryVersion}`
		];

		try {
			await this.$childProcess.spawnFromEvent(gradlew, localArgs, "close", { cwd: pluginBuildSettings.pluginDir });
		} catch (err) {
			throw new Error(`Failed to build plugin ${pluginBuildSettings.pluginName} : \n${err}`);
		}
	}

	private validateOptions(options: IBuildOptions): void {
		if (!options) {
			throw new Error("Android plugin cannot be built without passing an 'options' object.");
		}

		if (!options.pluginName) {
			this.$logger.info("No plugin name provided, defaulting to 'myPlugin'.");
		}

		if (!options.aarOutputDir) {
			this.$logger.info("No aarOutputDir provided, defaulting to the build outputs directory of the plugin");
		}

		if (!options.tempPluginDirPath) {
			throw new Error("Android plugin cannot be built without passing the path to a directory where the temporary project should be built.");
		}

		this.validatePlatformsAndroidDirPathOption(options);
	}

	private validatePlatformsAndroidDirPathOption(options: IBuildOptions): void {
		if (!options) {
			throw new Error("Android plugin cannot be built without passing an 'options' object.");
		}

		if (!options.platformsAndroidDirPath) {
			throw new Error("Android plugin cannot be built without passing the path to the platforms/android dir.");
		}
	}

}

$injector.register("androidPluginBuildService", AndroidPluginBuildService);
