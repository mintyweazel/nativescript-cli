///<reference path="../.d.ts"/>
"use strict";

import log4js = require("log4js");
import util = require("util");
import stream = require("stream");
import options = require("./options");
import Future = require("fibers/future");

export class Logger implements ILogger {
	private log4jsLogger: log4js.ILogger = null;
	private encodeRequestPaths: string[] = ['/appbuilder/api/itmstransporter/applications?username='];
	private encodeBody: boolean = false;
	private passwordRegex = /[Pp]assword=(.*?)(['&,]|$)|\"[Pp]assword\":\"(.*?)\"/;
	private requestBodyRegex = /^\"(.*?)\"$/;
	
	constructor($config: Config.IConfig) {
		var appenders: log4js.IAppender[] = [];

		if (!$config.CI_LOGGER) {
			appenders.push({
				type: "console",
				layout: {
					type: "messagePassThrough"
				}
			});
		}

		log4js.configure({appenders: appenders});

		this.log4jsLogger = log4js.getLogger();

		if (options.log) {
			this.log4jsLogger.setLevel(options.log);
		} else {
			this.log4jsLogger.setLevel($config.DEBUG ? "TRACE" : "INFO");
		}
	}

	setLevel(level: string): void {
		this.log4jsLogger.setLevel(level);
	}

	getLevel(): string {
		return this.log4jsLogger.level.toString();
	}

	fatal(...args: string[]): void {
		this.log4jsLogger.fatal.apply(this.log4jsLogger, args);
	}

	error(...args: string[]): void {
		var message = util.format.apply(null, args);
		var colorizedMessage = message.red;

		this.log4jsLogger.error.apply(this.log4jsLogger, [colorizedMessage]);
	}

	warn(...args: string[]): void {
		var message = util.format.apply(null, args);
		var colorizedMessage = message.yellow;

		this.log4jsLogger.warn.apply(this.log4jsLogger, [colorizedMessage]);
	}

	info(...args: string[]): void {
		this.log4jsLogger.info.apply(this.log4jsLogger, args);
	}

	debug(...args: string[]): void {
		var encodedArgs: string[] = this.getPasswordEncodedArguments(args);
		this.log4jsLogger.debug.apply(this.log4jsLogger, encodedArgs);
	}

	trace(...args: string[]): void {
		var encodedArgs: string[] = this.getPasswordEncodedArguments(args);
		this.log4jsLogger.trace.apply(this.log4jsLogger, encodedArgs);
	}

	out(...args: string[]): void {
		console.log(util.format.apply(null, args));
	}

	write(...args: string[]): void {
		process.stdout.write(util.format.apply(null, args));
	}

	prepare(item: any): string {
		if (typeof item === "undefined" || item === null) {
			return "[nothing]";
		}
		if (typeof item  === "string") {
			return item;
		}
		// do not try to read streams, because they may not be rewindable
		if (item instanceof stream.Readable) {
			return "[ReadableStream]";
		}

		return JSON.stringify(item);
	}

	public printInfoMessageOnSameLine(message: string): void {
		if(!options.log || options.log === "info") {
			this.write(message);
		}
	}

	public printMsgWithTimeout(message: string, timeout: number): IFuture <void> {
		var printMsgFuture = new Future<void>();
		setTimeout(() => {
			this.printInfoMessageOnSameLine(message);
			printMsgFuture.return();
		}, timeout);

		return printMsgFuture;
	}

	private getPasswordEncodedArguments(args: string[]): string[] {
		return _.map(args, argument => {
			if (typeof argument !== 'string') {
				return argument;
			}

			var passwordMatch = this.passwordRegex.exec(argument);
			if (passwordMatch) {
				var password = passwordMatch[1] || passwordMatch[3];
				return this.getHiddenPassword(password, argument);
			}

			if (this.encodeBody) {
				var bodyMatch = this.requestBodyRegex.exec(argument);
				if (bodyMatch) {
					return this.getHiddenPassword(bodyMatch[1], argument);
				}
			}

			_.each(this.encodeRequestPaths, path => {
					if (argument.indexOf('path') > -1) {
						this.encodeBody = argument.indexOf(path) > -1;
						return false;
					}
				})

			return argument;
		});
	}

	private getHiddenPassword(password: string, originalString: string) {
		return originalString.replace(password, new Array(password.length + 1).join('*'));
	}
}
$injector.register("logger", Logger);
