import * as fs from "fs";
import * as path from "path";
import * as restify from "restify";
import { promisify } from "util";
import axios from "axios";
const httpClient = axios.create({
  baseURL: "https://api.github.com",
});
// this mapping maybe read from a file
const readmeURL = "/repos/zxyanliu/hackathon-may-2020/contents"; //get file summary
//get commit
const sampleURL = "/repos/zxyanliu/BotBuilder-Samples/commits?path=";
const readmeCommit = "/repos/zxyanliu/hackathon-may-2020/commits?path=";

const readmeFile = [] as any;
const readFile = promisify(fs.readFile);
// Create HTTP server.
const server = restify.createServer();
server.listen(3978, (): void => {
  console.log(`\n${server.name} listening to ${server.url}`);
});

// const getfiles = async () => {
//   const readmeFolder = path.resolve(__dirname, "../readmes");
//   const readmes = {} as any;
//   if (fs.existsSync(readmeFolder)) {
//     const files = fs.readdirSync(readmeFolder);
//     for (const file of files) {
//       if (file.endsWith(".md")) {
//         const content = await readFile(path.join(readmeFolder, file), {
//           encoding: "utf-8",
//         });
//         readmes[file] = content;
//       }
//     }
//   }
//   return readmes;
// };

const getFilesFromGit = async (url: string) => {
  const result = await httpClient.get(url);
  return result.data;
};

const getReadmeFiles = async () => {
  //oauth
  await httpClient.get(
    "?access_token=646870601e9a9e7c432c38c076c33e27f9f46bad"
  );
  // increase rate limit , see https://developer.github.com/v3/#rate-limiting
  // await httpClient.get("/users/octocat");
  // get md files under one repo
  const result = await getFilesFromGit(readmeURL);
  const readmes = [];
  for (const file of result) {
    if (typeof file.name === "string" && file.name.endsWith(".md")) {
      const response = await axios.get(file.download_url);
      readmeFile.push(file);
      readmes.push({
        name: file.name,
        content: response.data,
        url: file.html_url,
      });
    }
  }
  return readmes;
};

// get all samples links from md files
const getLinks = async () => {
  const files = await getReadmeFiles();
  const links = {} as any;
  // get all the links
  for (const file of files) {
    const result = file.content.match(
      /(((http|https|ftp):\/\/[\w\-_]+(\.[\w\-_]+)+)|~\/|\.+\/)([\w\-\.,@?^=%&:/~\+#]*[\w\-\@?^=%&/~\+#])+/g
    );
    if (result && result.length > 0) {
      const author = file.content.match(/ms\.author:\s*[\w-_]+/g);
      console.log(author && author[0].substring(10).trim());
      links[file.name] = {
        url: file.url,
        author: (author && author[0].substring(10).trim()) || "v-liyan",
        links: result,
      };
    }
  }
  return links;
};

// get links include range, means code links
const getCodeLinks = async () => {
  const links = await getLinks();
  const codeLinks = {} as any;
  for (const key in links) {
    const temp = [] as any;
    links[key].links.map((str) => {
      if (/\?range/.test(str)) {
        temp.push(str);
      }
    });
    if (temp.length > 0) {
      codeLinks[key] = {
        url: links[key].url,
        author: links[key].author || "v-liyan",
        links: temp,
      };
    }
  }
  return codeLinks;
};

// get sample commits from the date
const getSampleCommits = async (date: string) => {
  const links = await getCodeLinks();
  const mdSampleCommitMap = {} as any;
  for (const key in links) {
    mdSampleCommitMap[links[key].url] = {
      author: links[key].author,
      links: [],
    } as any;
    for (const str of links[key].links) {
      let url = str;
      if (/~\//.test(str)) {
        url = str.replace("~/../botbuilder-samples", sampleURL);
        url = url.substring(0, url.indexOf("?range"));
        url = url + `&since=${date}`;
      }

      const content = await httpClient.get(url);
      if (content.data.length > 0) {
        mdSampleCommitMap[links[key].url].links.push({
          fileName: str,
          date: content.data[0].commit.author.date,
          commitUrl: content.data[0].html_url,
        });
      }
    }
  }
  return mdSampleCommitMap;
};

const getMDFileCommits = async (date: string) => {
  const mdCommitMap = {} as any;
  for (const item of readmeFile) {
    const filepath = readmeCommit + item.name + `&since=${date}`;

    const content = await httpClient.get(filepath);
    if (content.data.length > 0) {
      mdCommitMap[item.html_url] = content.data[0].commit.author.date;
    }
  }
  return mdCommitMap;
};

server.get("/api/files", async (req, res) => {
  res.json(await getReadmeFiles());
});

server.get("/api/links", async (req, res) => {
  res.json(await getCodeLinks());
});

server.use(restify.plugins.queryParser());
server.get("/api/check", async (req, res) => {
  if (req.query && req.query.date) {
    try {
      const samples = await getSampleCommits(req.query.date);
      const mdfiles = await getMDFileCommits(req.query.date);
      console.log(samples);
      console.log(mdfiles);
      // search update or not
      const update = [] as any;
      for (const mdFileUrl in samples) {
        if (mdfiles[mdFileUrl]) {
          const mdtime = mdfiles[mdFileUrl];
          const updatesample = [] as any;
          for (const item of samples[mdFileUrl].links) {
            if (mdtime < item.date) {
              updatesample.push(item);
            }
          }
          updatesample.length > 0 &&
            update.push({
              file: mdFileUrl,
              samples: updatesample,
              author: samples[mdFileUrl].author,
            });
        } else {
          update.push({
            file: mdFileUrl,
            samples: samples[mdFileUrl].links,
            author: samples[mdFileUrl].author,
          });
        }
      }
      update.length > 0 ? res.json(update) : res.send("no need for update");
    } catch (error) {
      console.log(error);
    }
  }
});
