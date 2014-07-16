///<reference path="../.d.ts"/>

import path = require("path");
import options = require("./options");

export class ProjectHelper implements IProjectHelper {
	constructor(private $logger: ILogger,
		private $fs: IFileSystem,
		private $config) { }

	private cachedProjectDir = "";

	public get projectDir(): string {
		if (this.cachedProjectDir !== "") {
			return this.cachedProjectDir;
		}
		this.cachedProjectDir = null;

		var projectDir = path.resolve(options.path || ".");
		while (true) {
			this.$logger.trace("Looking for project in '%s'", projectDir);

			if (this.$fs.exists(path.join(projectDir, this.$config.PROJECT_FILE_NAME)).wait()) {
				this.$logger.debug("Project directory is '%s'.", projectDir);
				this.cachedProjectDir = projectDir;
				break;
			}

			var dir = path.dirname(projectDir);
			if (dir === projectDir) {
				this.$logger.debug("No project found at or above '%s'.", path.resolve("."));
				break;
			}
			projectDir = dir;
		}

		return this.cachedProjectDir;
	}
}
$injector.register("projectHelper", ProjectHelper);
