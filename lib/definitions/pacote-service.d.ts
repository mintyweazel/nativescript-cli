import * as pacote from "pacote";
import * as tar from "tar";

declare global {

	interface IPacoteService {
		/**
		 * 
		 * @param packageName The name of the package
		 * @param options The provided options can control which properties from package.json file will be returned. (In case when fullMetadata option is provided, all data from package.json file will be returned)
		 */
		manifest(packageName: string, options: IPacoteManifestOptions): Promise<any>;
		/**
		 * Downloads the specified package and extracts it in specified destination directory
		 * @param packageName The name of the package
		 * @param destinationDirectory The path to directory where the downloaded tarball will be extracted.
		 */
		downloadAndExtract(packageName: string, destinationDirectory: string, options?: IPacoteExtractOptions): Promise<void>;
	}

	interface IPacoteBaseOptions {
		/**
		 * The path to npm cache
		 */
		cache?: string;
	}

	interface IPacoteManifestOptions extends IPacoteBaseOptions {
		/**
		 * If true, the whole package.json data will be returned
		 */
		fullMetadata?: boolean;
	}

	interface IPacoteTarballStreamOptions extends IPacoteBaseOptions { }

	interface IPacoteExtractOptions {
		filter?: (path: string, stat: tar.FileStat) => boolean;
	}
}