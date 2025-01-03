const fs = require("fs");
const { exec } = require("child_process");
const axios = require("axios");
const path = require("path");

const MAX_RETRIES = 3;

async function installModules(configPath, isPerformanceMode) {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file ${configPath} not found.`);
  }

  const packageJson = JSON.parse(fs.readFileSync(configPath, "utf-8"));

  if (!packageJson["dependencies-custom"]) {
    throw new Error("No 'dependencies-custom' field found in package.json.");
  }

  const modules = packageJson["dependencies-custom"]["module"];
  if (!modules) {
    throw new Error("No modules found under 'dependencies-custom'.");
  }

  const installPromises = Object.entries(modules).map(([moduleName, source]) =>
    installModule(moduleName, source, isPerformanceMode)
  );

  try {
    if (isPerformanceMode) {
      // Execute all module installations concurrently
      await Promise.all(installPromises);
    } else {
      // Execute module installations sequentially
      for (const promise of installPromises) {
        await promise;
      }
    }
    console.log("All modules installed successfully.");
  } catch (err) {
    console.error("Module installation failed:", err.message);
    process.exit(1);
  }
}

async function installModule(moduleName, source, isPerformanceMode) {
  let retryCount = 0;
  while (retryCount < MAX_RETRIES) {
    try {
      if (source.startsWith("npm:")) {
        await installFromNpm(source.replace("npm:", ""));
      } else if (source.startsWith("git:") || source.startsWith("github:")) {
        await installFromGit(source);
      } else if (source.startsWith("https://")) {
        await installFromUrl(source);
      } else {
        throw new Error(`Invalid source type for module ${moduleName}`);
      }

      console.log(`Successfully installed module: ${moduleName}`);
      return;
    } catch (err) {
      retryCount++;
      console.warn(
        `Failed to install module: ${moduleName}. Retrying (${retryCount}/${MAX_RETRIES})...`
      );
    }
  }

  throw new Error(`Failed to install module: ${moduleName} after ${MAX_RETRIES} attempts.`);
}

function installFromNpm(moduleSpecifier) {
  return new Promise((resolve, reject) => {
    exec(`npm install ${moduleSpecifier}`, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
      } else {
        console.log(stdout);
        resolve();
      }
    });
  });
}

function installFromGit(source) {
  return new Promise((resolve, reject) => {
    const gitUrl = source.replace(/^(git:|github:)/, "https://");
    exec(`npm install ${gitUrl}`, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
      } else {
        console.log(stdout);
        resolve();
      }
    });
  });
}

async function installFromUrl(source) {
  const tempDir = path.join(__dirname, "temp_modules");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir);
  }

  const modulePath = path.join(tempDir, path.basename(source));
  const writer = fs.createWriteStream(modulePath);

  const response = await axios({
    url: source,
    method: "GET",
    responseType: "stream",
  });

  return new Promise((resolve, reject) => {
    response.data.pipe(writer);
    writer.on("finish", () => {
      exec(`npm install ${modulePath}`, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
        } else {
          console.log(stdout);
          resolve();
        }
      });
    });
    writer.on("error", (err) => {
      reject(err);
    });
  });
}

// Entry point to install modules based on the config
async function startInstallation() {
  try {
    const configPath = path.resolve(__dirname, "../../package.json");
    const packageJson = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const isPerformanceMode = packageJson["dependencies-custom"]?.performance === true;

    await installModules(configPath, isPerformanceMode);
    console.log("All dependencies have been installed successfully.");
  } catch (err) {
    console.error("Installation failed:", err.message);
    process.exit(1);
  }
}

startInstallation();
